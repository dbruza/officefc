import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID } from "./config";
import { calculateSeason } from "./elo";
import { deriveLeagueStats, type ConfirmedMatchInput } from "./stats";
import { dateMillis, seasonMatchInputsWithTeams } from "./utils";

/**
 * Rebuild a season's ELO, standings, and eloHistory from its confirmed matches.
 * Stale standings/history docs (players with no remaining games) are pruned. The per-player
 * `move` indicator is carried over from the previous standings. Throws if the season is gone.
 */
export async function recalcSeasonElo(seasonId: string): Promise<void> {
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

  const matches = await seasonMatchInputsWithTeams(matchSnaps.docs, db);
  const result = calculateSeason(
    matches,
    members.docs.map((snap) => snap.id),
    dateMillis(season.get("start")),
  );

  const writer = db.bulkWriter();
  const standingIds = new Set(result.standings.map((standing) => standing.uid));
  const historyIds = new Set(Object.keys(result.history));
  for (const snap of oldStandings.docs) {
    if (!standingIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHistory.docs) {
    if (!historyIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const match of result.matches) {
    writer.set(
      db.doc(`matches/${match.id}`),
      {
        aEloBefore: match.aEloBefore,
        aEloAfter: match.aEloAfter,
        aDelta: match.aDelta,
        bEloBefore: match.bEloBefore,
        bEloAfter: match.bEloAfter,
        bDelta: match.bDelta,
        recalculatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  const previousMove = new Map<string, number>();
  for (const snap of oldStandings.docs) {
    const move = snap.get("move");
    if (typeof move === "number") previousMove.set(snap.id, move);
  }
  for (const standing of result.standings) {
    writer.set(seasonRef.collection("standings").doc(standing.uid), {
      ...standing,
      move: previousMove.get(standing.uid) ?? standing.move,
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const [uid, points] of Object.entries(result.history)) {
    writer.set(seasonRef.collection("eloHistory").doc(uid), {
      points: points.map((point) => ({
        matchId: point.matchId,
        date: Timestamp.fromMillis(point.dateMillis),
        rating: point.rating,
      })),
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}

/** Rebuild the league-wide playerStats and head-to-head read models from all confirmed matches. */
export async function recalcLeagueStats(): Promise<void> {
  const db = getFirestore();
  const [members, matchSnaps, oldPlayerStats, oldHeadToHead] = await Promise.all([
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
    db.collection("matches").where("status", "==", "confirmed").get(),
    db.collection("playerStats").get(),
    db.collection("h2h").get(),
  ]);
  const matches: ConfirmedMatchInput[] = matchSnaps.docs.map((snap) => {
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
  const result = deriveLeagueStats(
    matches,
    members.docs.map((snap) => snap.id),
  );

  const writer = db.bulkWriter();
  const playerIds = new Set(result.players.map((player) => player.uid));
  const pairKeys = new Set(result.headToHead.map((pair) => pair.pairKey));
  for (const snap of oldPlayerStats.docs) {
    if (!playerIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHeadToHead.docs) {
    if (!pairKeys.has(snap.id)) writer.delete(snap.ref);
  }
  for (const player of result.players) {
    writer.set(db.doc(`playerStats/${player.uid}`), {
      ...player,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const pair of result.headToHead) {
    writer.set(db.doc(`h2h/${pair.pairKey}`), {
      ...pair,
      meetings: pair.meetings.map((meeting) => ({
        ...meeting,
        date: Timestamp.fromMillis(meeting.dateMillis),
      })),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}
