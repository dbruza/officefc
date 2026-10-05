import { ModelWriter, type RebuildLease } from "./modelWriter";
import { summaryMatch, seasonSummary, playerSummary } from "./models/summaries";
import type { Team } from "./models/types";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID } from "./config";
import { calculateSeason } from "./elo";
import { deriveLeagueStats, type ConfirmedMatchInput } from "./stats";
import { dateMillis, seasonMatchInputsWithTeams } from "./utils";
import { activeMemberIds } from "./members";

/**
 * Rebuild a season's ELO, standings, and eloHistory from its confirmed matches.
 * Stale standings/history docs (players with no remaining games) are pruned. The per-player
 * `move` indicator is the rank change vs the previous standings snapshot. Throws if the
 * season is gone.
 */
export async function recalcSeasonElo(seasonId: string, lease: RebuildLease): Promise<void> {
  const db = getFirestore();
  const seasonRef = db.doc(`seasons/${seasonId}`);
  const [season, members, matchSnaps, oldStandings, oldHistory] = await Promise.all([
    seasonRef.get(),
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
    db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .where("status", "==", "confirmed")
      .get(),
    seasonRef.collection("standings").get(),
    seasonRef.collection("eloHistory").get(),
  ]);
  if (!season.exists) throw new HttpsError("not-found", "Season not found.");

  // Finals matches decide the bracket only — they never move ELO or the table.
  const regularDocs = matchSnaps.docs.filter((doc) => doc.get("finals") !== true);
  const matches = await seasonMatchInputsWithTeams(regularDocs, db);
  const premierId = season.get("reigningPremierId");
  const result = calculateSeason(
    matches,
    activeMemberIds(members.docs),
    dateMillis(season.get("start")),
    { premierId: typeof premierId === "string" ? premierId : null },
  );

  const writer = new ModelWriter(lease);
  const standingIds = new Set(result.standings.map((standing) => standing.uid));
  const historyIds = new Set(Object.keys(result.history));
  for (const snap of oldStandings.docs) {
    if (!standingIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHistory.docs) {
    if (!historyIds.has(snap.id)) writer.delete(snap.ref);
  }
  const oldMatches = new Map(matchSnaps.docs.map((snap) => [snap.id, snap.data()]));
  for (const match of result.matches) {
    writer.set(
      db.doc(`matches/${match.id}`),
      {
        sortDate: Timestamp.fromMillis(match.dateMillis),
        leaderBeforeId: match.leaderBeforeId,
        leaderAfterId: match.leaderAfterId,
        winnerStreakAfter: match.winnerStreakAfter,
        aEloBefore: match.aEloBefore,
        aEloAfter: match.aEloAfter,
        aDelta: match.aDelta,
        bEloBefore: match.bEloBefore,
        bEloAfter: match.bEloAfter,
        bDelta: match.bDelta,
        ...(match.eloExplain ? { eloExplain: match.eloExplain } : {}),
        recalculatedAt: FieldValue.serverTimestamp(),
      },
      oldMatches.get(match.id),
      { merge: true },
    );
  }

  for (const snap of matchSnaps.docs.filter((row) => row.get("finals") === true)) {
    writer.set(
      snap.ref,
      {
        sortDate: Timestamp.fromMillis(
          dateMillis(snap.get("date") ?? snap.get("confirmedAt") ?? snap.get("createdAt")),
        ),
      },
      snap.data(),
      { merge: true },
    );
  }
  // Movement = rank change vs the previous standings snapshot (positive = climbed), so the
  // arrows reflect what THIS recalc changed instead of carrying a stale stored value.
  const previousRank = new Map<string, number>();
  for (const snap of oldStandings.docs) {
    const rank = snap.get("rank");
    if (typeof rank === "number") previousRank.set(snap.id, rank);
  }
  for (const standing of result.standings) {
    const rankBefore = previousRank.get(standing.uid);
    writer.set(
      seasonRef.collection("standings").doc(standing.uid),
      {
        ...standing,
        move: rankBefore != null ? rankBefore - standing.rank : 0,
        recalculatedAt: FieldValue.serverTimestamp(),
      },
      oldStandings.docs.find((snap) => snap.id === standing.uid)?.data(),
    );
  }
  for (const [uid, points] of Object.entries(result.history)) {
    writer.set(
      seasonRef.collection("eloHistory").doc(uid),
      {
        points: points.map((point) => ({
          matchId: point.matchId,
          date: Timestamp.fromMillis(point.dateMillis),
          rating: point.rating,
        })),
        recalculatedAt: FieldValue.serverTimestamp(),
      },
      oldHistory.docs.find((snap) => snap.id === uid)?.data(),
    );
  }
  const calculatedById = new Map(result.matches.map((match) => [match.id, match]));
  const summaryMatches = matchSnaps.docs.map((snap) => {
    const data = { ...snap.data(), ...calculatedById.get(snap.id) };
    return summaryMatch(snap.id, data, dateOf(snap.get("date")));
  });
  const summaryRef = db.doc(`seasonSummaries/${seasonId}`);
  const previous = await summaryRef.get();
  writer.set(
    summaryRef,
    { ...seasonSummary(summaryMatches, await teamMap()), updatedAt: FieldValue.serverTimestamp() },
    previous.data(),
  );
  await writer.close();
  logger.info("season_models_rebuilt", {
    seasonId,
    matches: matchSnaps.size,
    writes: writer.count,
  });
}

/** Rebuild the league-wide playerStats and head-to-head read models from all confirmed matches. */
export async function recalcLeagueStats(lease: RebuildLease): Promise<void> {
  const db = getFirestore();
  const [members, matchSnaps, oldPlayerStats, oldHeadToHead] = await Promise.all([
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
    db.collection("matches").where("status", "==", "confirmed").get(),
    db.collection("playerStats").get(),
    db.collection("h2h").get(),
  ]);
  const matches: ConfirmedMatchInput[] = matchSnaps.docs
    // Finals matches decide the bracket only — excluded from playerStats and h2h.
    .filter((snap) => snap.get("finals") !== true)
    .map((snap) => {
      const data = snap.data();
      return {
        id: snap.id,
        seasonId: String(data.seasonId),
        aId: String(data.aId),
        bId: String(data.bId),
        aGoals: Number(data.aGoals),
        bGoals: Number(data.bGoals),
        aDelta: Number(data.aDelta ?? 0),
        bDelta: Number(data.bDelta ?? 0),
        dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
      };
    });
  const result = deriveLeagueStats(matches, activeMemberIds(members.docs));

  const writer = new ModelWriter(lease);
  const playerIds = new Set(result.players.map((player) => player.uid));
  const pairKeys = new Set(result.headToHead.map((pair) => pair.pairKey));
  for (const snap of oldPlayerStats.docs) {
    if (!playerIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHeadToHead.docs) {
    if (!pairKeys.has(snap.id)) writer.delete(snap.ref);
  }
  for (const row of matchSnaps.docs)
    writer.set(
      row.ref,
      {
        sortDate: Timestamp.fromMillis(
          dateMillis(row.get("date") ?? row.get("confirmedAt") ?? row.get("createdAt")),
        ),
      },
      row.data(),
      { merge: true },
    );
  const allMatches = matchSnaps.docs.map((snap) =>
    summaryMatch(snap.id, snap.data(), dateOf(snap.get("date"))),
  );
  const byPlayer = new Map<string, typeof allMatches>();
  for (const match of allMatches)
    for (const uid of [match.aId, match.bId]) {
      const mine = byPlayer.get(uid) ?? [];
      mine.push(match);
      byPlayer.set(uid, mine);
    }
  const teams = await teamMap();
  for (const player of result.players) {
    writer.set(
      db.doc(`playerStats/${player.uid}`),
      {
        ...player,
        summary: playerSummary(player.uid, byPlayer.get(player.uid) ?? [], teams),
        updatedAt: FieldValue.serverTimestamp(),
      },
      oldPlayerStats.docs.find((snap) => snap.id === player.uid)?.data(),
    );
  }
  for (const pair of result.headToHead) {
    writer.set(
      db.doc(`h2h/${pair.pairKey}`),
      {
        ...pair,
        meetings: pair.meetings.map((meeting) => ({
          ...meeting,
          date: Timestamp.fromMillis(meeting.dateMillis),
        })),
        updatedAt: FieldValue.serverTimestamp(),
      },
      oldHeadToHead.docs.find((snap) => snap.id === pair.pairKey)?.data(),
    );
  }
  await writer.close();
  logger.info("league_models_rebuilt", { matches: matchSnaps.size, writes: writer.count });
}

function dateOf(value: unknown): Date | null {
  const millis = dateMillis(value);
  return millis ? new Date(millis) : null;
}
async function teamMap(): Promise<Map<string, Team>> {
  const snapshot = await getFirestore().doc("teamCatalogues/current").get();
  const teams = snapshot.get("teams");
  return new Map((Array.isArray(teams) ? teams : []).map((team: Team) => [team.id, team]));
}

export async function rebuildFrozenSeasonSummary(
  seasonId: string,
  lease: RebuildLease,
): Promise<void> {
  const db = getFirestore();
  const [matches, previous] = await Promise.all([
    db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .where("status", "==", "confirmed")
      .get(),
    db.doc(`seasonSummaries/${seasonId}`).get(),
  ]);
  const writer = new ModelWriter(lease);
  for (const row of matches.docs)
    writer.set(
      row.ref,
      {
        sortDate: Timestamp.fromMillis(
          dateMillis(row.get("date") ?? row.get("confirmedAt") ?? row.get("createdAt")),
        ),
      },
      row.data(),
      { merge: true },
    );
  writer.set(
    previous.ref,
    {
      ...seasonSummary(
        matches.docs.map((row) => summaryMatch(row.id, row.data(), dateOf(row.get("date")))),
        await teamMap(),
      ),
      updatedAt: FieldValue.serverTimestamp(),
    },
    previous.data(),
  );
  await writer.close();
}
