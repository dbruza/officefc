import { modelVersion, assertQueueIdleTx } from "./rebuildQueue";
import { HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp, Filter, FieldPath } from "firebase-admin/firestore";
import { loggedOnCall } from "./logging";
import { instrumentBackground } from "./sentry";
import { LEAGUE_ID } from "./config";
import { requireAuth, assertMember } from "./auth";
import { BASE_ELO } from "./elo";
import {
  assignFixtureTeams,
  FIXTURE_EXPIRY_MS,
  FIXTURE_MAX_REROLLS,
  FIXTURE_NOVELTY_WINDOW,
  type FixtureTeam,
} from "./fixtureRules";
import { dateMillis } from "./utils";
import { sendPush } from "./notify";
import {
  activeMemberIds,
  BLOCKED_MATCH_MESSAGE,
  isActiveMember,
  isBlockedBetween,
} from "./members";

const db = getFirestore();

function fixtureDocId(seasonId: string, uidA: string, uidB: string): string {
  return `${seasonId}_${[uidA, uidB].sort().join("_")}`;
}

/** Client-facing fixture shape: explicit fields only, timestamps as millis, so no
 *  Firestore sentinels or Timestamp instances leak into the callable response. */
function fixturePayload(id: string, data: Record<string, unknown>) {
  return {
    id,
    seasonId: String(data.seasonId),
    aId: String(data.aId),
    bId: String(data.bId),
    aTeamId: String(data.aTeamId),
    aTeamName: String(data.aTeamName),
    aTeamOverall: Number(data.aTeamOverall),
    bTeamId: String(data.bTeamId),
    bTeamName: String(data.bTeamName),
    bTeamOverall: Number(data.bTeamOverall),
    aElo: Number(data.aElo),
    bElo: Number(data.bElo),
    targetDiff: Number(data.targetDiff),
    status: String(data.status),
    rerollCount: Number(data.rerollCount ?? 0),
    expiresAtMillis: dateMillis(data.expiresAt),
  };
}

/** Team ids `uid` used in their most recent season matches, newest first, capped at the
 *  novelty window. Voided matches still count — the team was played either way. */
export function recentTeamIds(
  matchDocs: Array<{ get(field: string): unknown }>,
  uid: string,
): Set<string> {
  const ids = new Set<string>();
  for (const doc of matchDocs) {
    if (ids.size >= FIXTURE_NOVELTY_WINDOW) break;
    const aId = String(doc.get("aId") ?? "");
    const bId = String(doc.get("bId") ?? "");
    if (aId !== uid && bId !== uid) continue;
    const teamId = String((aId === uid ? doc.get("aTeamId") : doc.get("bTeamId")) ?? "");
    if (teamId) ids.add(teamId);
  }
  return ids;
}

/** Everything team-dealing needs for one season: the rated active-team pool and the
 *  season's matches newest-first (for the novelty exclusion). Shared with finals dealing. */
export async function loadDealingContext(
  seasonId: string,
  participantIds?: string[],
): Promise<{
  pool: FixtureTeam[];
  seasonMatchesByDateDesc: Array<{ get(field: string): unknown }>;
}> {
  const snapshot = await db.doc("teamCatalogues/current").get();
  const bundled = snapshot.get("teams");
  const teamRows: Array<Record<string, unknown>> = Array.isArray(bundled)
    ? bundled
    : (await db.collection("teams").where("active", "==", true).get()).docs.map((row) => ({
        id: row.id,
        ...row.data(),
      }));
  const pool = teamRows
    .filter((team) => typeof team.overall === "number" && Number.isFinite(team.overall))
    .map((team) => ({
      id: String(team.id),
      name: String(team.name),
      overall: Number(team.overall),
    }));
  const ids =
    participantIds ??
    activeMemberIds((await db.collection(`leagues/${LEAGUE_ID}/members`).get()).docs);
  const recent = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  await Promise.all(
    [...new Set(ids)].map(async (uid) => {
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      const seen = new Set<string>();
      while (seen.size < FIXTURE_NOVELTY_WINDOW) {
        let query = db
          .collection("matches")
          .where("seasonId", "==", seasonId)
          .where(Filter.or(Filter.where("aId", "==", uid), Filter.where("bId", "==", uid)))
          .orderBy("date", "desc")
          .orderBy(FieldPath.documentId())
          .limit(25);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const row of page.docs) {
          recent.set(row.id, row);
          const team = row.get(row.get("aId") === uid ? "aTeamId" : "bTeamId");
          if (typeof team === "string" && team) seen.add(team);
          if (seen.size >= FIXTURE_NOVELTY_WINDOW) break;
        }
        if (page.size < 25) break;
        cursor = page.docs.at(-1);
      }
    }),
  );
  return {
    pool,
    seasonMatchesByDateDesc: [...recent.values()].sort(
      (a, b) => dateMillis(b.get("date")) - dateMillis(a.get("date")) || a.id.localeCompare(b.id),
    ),
  };
}

/**
 * Deal (or return the already-dealt) auto-matchup fixture between the caller and an
 * opponent. One live fixture per pair per season: repeat calls return the same deal until
 * it is played, rerolled (once), or expires. The caller is always fixture side A.
 */
export const createFixture = loggedOnCall("createFixture", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);

  const opponentId = String(req.data?.opponentId ?? "").trim();
  const reroll = Boolean(req.data?.reroll);
  if (!opponentId) throw new HttpsError("invalid-argument", "opponentId is required.");
  if (opponentId === uid) throw new HttpsError("invalid-argument", "You cannot play yourself.");

  const opponentMember = await db.doc(`leagues/${LEAGUE_ID}/members/${opponentId}`).get();
  if (!isActiveMember(opponentMember))
    throw new HttpsError("invalid-argument", "Opponent not a member.");
  if (await isBlockedBetween(uid, opponentId))
    throw new HttpsError("failed-precondition", BLOCKED_MATCH_MESSAGE);

  const seasonSnap = await db.collection("seasons").where("active", "==", true).limit(1).get();
  if (seasonSnap.empty) throw new HttpsError("failed-precondition", "No active season.");
  const seasonId = seasonSnap.docs[0].id;

  const fixtureRef = db.doc(`fixtures/${fixtureDocId(seasonId, uid, opponentId)}`);
  const existing = await fixtureRef.get();
  const existingData = existing.exists ? existing.data()! : null;
  const live =
    existingData?.status === "proposed" && dateMillis(existingData.expiresAt) > Date.now();

  if (live && !reroll) {
    return { ok: true, fixture: fixturePayload(fixtureRef.id, existingData!) };
  }
  if (live && reroll && Number(existingData?.rerollCount ?? 0) >= FIXTURE_MAX_REROLLS) {
    throw new HttpsError("failed-precondition", "No rerolls left for this matchup.");
  }

  const generation = await modelVersion();
  const [aStanding, bStanding, dealing] = await Promise.all([
    db.doc(`seasons/${seasonId}/standings/${uid}`).get(),
    db.doc(`seasons/${seasonId}/standings/${opponentId}`).get(),
    loadDealingContext(seasonId, [uid, opponentId]),
  ]);
  const { pool, seasonMatchesByDateDesc: byDateDesc } = dealing;
  const aRecent = recentTeamIds(byDateDesc, uid);
  const bRecent = recentTeamIds(byDateDesc, opponentId);
  // A reroll must actually change the deal: exclude the currently-dealt teams too.
  if (live && reroll && existingData) {
    aRecent.add(String(existingData.aTeamId));
    bRecent.add(String(existingData.bTeamId));
  }

  const aElo = Number(aStanding.get("elo") ?? BASE_ELO) || BASE_ELO;
  const bElo = Number(bStanding.get("elo") ?? BASE_ELO) || BASE_ELO;

  let assignment;
  try {
    assignment = assignFixtureTeams({
      pool,
      aElo,
      bElo,
      aRecentTeamIds: aRecent,
      bRecentTeamIds: bRecent,
    });
  } catch (error) {
    throw new HttpsError("failed-precondition", (error as Error).message);
  }

  const expiresAt = Timestamp.fromMillis(Date.now() + FIXTURE_EXPIRY_MS);
  const fixture = {
    seasonId,
    aId: uid,
    bId: opponentId,
    aTeamId: assignment.aTeam.id,
    aTeamName: assignment.aTeam.name,
    aTeamOverall: assignment.aTeam.overall,
    bTeamId: assignment.bTeam.id,
    bTeamName: assignment.bTeam.name,
    bTeamOverall: assignment.bTeam.overall,
    aElo,
    bElo,
    targetDiff: assignment.targetDiff,
    status: "proposed",
    rerollCount: live && reroll ? Number(existingData?.rerollCount ?? 0) + 1 : 0,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    matchId: null,
  };
  await db.runTransaction(async (tx) => {
    await assertQueueIdleTx(tx, generation);
    const current = await tx.get(fixtureRef);
    const season = await tx.get(db.doc(`seasons/${seasonId}`));
    if (!season.get("active") || season.get("finalized"))
      throw new HttpsError("failed-precondition", "The season changed. Reload and retry.");
    if (current.updateTime?.toMillis() !== existing.updateTime?.toMillis())
      throw new HttpsError("aborted", "This matchup changed. Reload to use the latest deal.");
    tx.set(fixtureRef, fixture);
  });
  logger.info("createFixture", {
    fixtureId: fixtureRef.id,
    aId: uid,
    bId: opponentId,
    aTeam: assignment.aTeam.id,
    bTeam: assignment.bTeam.id,
    targetDiff: assignment.targetDiff,
    reroll,
  });

  if (!(live && reroll)) {
    await sendPush(
      opponentId,
      "Auto matchup dealt",
      `You got ${assignment.bTeam.name} (${assignment.bTeam.overall}). Winner takes the ELO.`,
      { type: "fixture_created", fixtureId: fixtureRef.id },
    );
  }

  return { ok: true, fixture: fixturePayload(fixtureRef.id, fixture) };
});

/** Mark a fixture as played when a match referencing it lands, so the pair can deal a
 *  fresh one. Duplicate submissions are blocked upstream (rules / callable require the
 *  fixture to still be `proposed`). */
export const consumeFixture = onDocumentCreated(
  "matches/{matchId}",
  instrumentBackground("consumeFixture", async (event) => {
    const fixtureId = event.data?.get("fixtureId");
    if (typeof fixtureId !== "string" || !fixtureId) return;
    await db.doc(`fixtures/${fixtureId}`).set(
      {
        status: "submitted",
        matchId: event.params.matchId,
        consumedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }),
);
