/**
 * IO layer for the finals series. Bracket state lives at `seasons/{id}/finals/bracket`
 * (member-readable via the seasons subtree rules; all writes happen here via the Admin
 * SDK). Pure bracket logic is in finalsRules.ts; team dealing reuses the auto-matchup
 * engine with EQUAL ELOs — finals ties are played on equal-OVR teams, pure skill.
 *
 * Finals matches never touch ELO/stats: recalc, league stats, and POTM all exclude
 * `finals: true` match docs, and confirmMatch routes finals confirmations here instead
 * of into the recalc pipeline.
 */
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loggedOnCall } from "./logging";
import { requireAuth, assertAdmin } from "./auth";
import { assignFixtureTeams } from "./fixtureRules";
import {
  advanceBracket,
  bracketComplete,
  buildBracket,
  type FinalsBracket,
  type FinalsDecidedBy,
  type FinalsSlot,
  type FinalsSlotKey,
} from "./finalsRules";
import { loadDealingContext, recentTeamIds } from "./fixtures";
import { emitFinalsResultActivity, emitFinalsSetActivity } from "./activityFeed";
import { sendPush } from "./notify";

const db = getFirestore();

function bracketRef(seasonId: string) {
  return db.doc(`seasons/${seasonId}/finals/bracket`);
}

/** Deal equal-OVR teams to every listed slot. Both sides are fed the same rating on
 *  purpose: finals are decided on skill, so the target OVR gap is zero regardless of the
 *  players' actual ELO. Recent teams (including earlier finals ties) are still avoided. */
async function dealTeamsForSlots(
  bracket: FinalsBracket,
  slotKeys: FinalsSlotKey[],
  seasonId: string,
): Promise<void> {
  if (slotKeys.length === 0) return;
  const { pool, seasonMatchesByDateDesc } = await loadDealingContext(seasonId);
  for (const key of slotKeys) {
    const slot = bracket.slots[key];
    if (!slot || !slot.homeId || !slot.awayId) continue;
    const deal = assignFixtureTeams({
      pool,
      aElo: 1500,
      bElo: 1500,
      aRecentTeamIds: recentTeamIds(seasonMatchesByDateDesc, slot.homeId),
      bRecentTeamIds: recentTeamIds(seasonMatchesByDateDesc, slot.awayId),
    });
    slot.homeTeamId = deal.aTeam.id;
    slot.homeTeamName = deal.aTeam.name;
    slot.homeTeamOverall = deal.aTeam.overall;
    slot.awayTeamId = deal.bTeam.id;
    slot.awayTeamName = deal.bTeam.name;
    slot.awayTeamOverall = deal.bTeam.overall;
  }
}

function bracketFromSnap(data: Record<string, unknown>): FinalsBracket {
  return {
    structure: data.structure,
    seeds: data.seeds,
    premierId: data.premierId,
    slots: data.slots,
  } as FinalsBracket;
}

/**
 * Lock the finals: snapshot the ranked top-6 (or best available structure) as seeds,
 * deal equal teams for the opening ties, and flip the season into the finals phase.
 * The #1 seed at this moment is the season's Premier — later matches can't move it.
 */
export const startFinals = loggedOnCall("startFinals", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");

  const seasonSnap = await db.doc(`seasons/${seasonId}`).get();
  if (!seasonSnap.exists) throw new HttpsError("not-found", "Season not found.");
  if (seasonSnap.get("finalized"))
    throw new HttpsError("failed-precondition", "Season is already finalized.");
  if (!seasonSnap.get("active"))
    throw new HttpsError("failed-precondition", "Only the active season can start finals.");
  if (seasonSnap.get("phase") === "finals")
    throw new HttpsError("failed-precondition", "Finals have already started.");

  const standingsSnap = await db.collection(`seasons/${seasonId}/standings`).get();
  const seeds = standingsSnap.docs
    .map((doc) => ({
      uid: doc.id,
      rank: Number(doc.get("rank") ?? 0),
      elo: Number(doc.get("elo") ?? 0),
      ranked: doc.get("ranked") === true,
    }))
    .filter((row) => row.ranked && row.rank >= 1)
    .sort((a, b) => a.rank - b.rank)
    .map(({ uid: seedUid, rank, elo }) => ({ uid: seedUid, rank, elo }));

  let bracket: FinalsBracket;
  try {
    bracket = buildBracket(seeds);
  } catch (error) {
    throw new HttpsError("failed-precondition", (error as Error).message);
  }
  const openSlots = (Object.values(bracket.slots) as FinalsSlot[])
    .filter((slot) => slot.status === "open")
    .map((slot) => slot.key);
  await dealTeamsForSlots(bracket, openSlots, seasonId);

  await bracketRef(seasonId).set({
    ...bracket,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });
  await db.doc(`seasons/${seasonId}`).update({
    phase: "finals",
    finalsStartedAt: FieldValue.serverTimestamp(),
  });

  const seasonName = String(seasonSnap.get("name") ?? seasonId);
  await emitFinalsSetActivity({
    seasonId,
    seasonName,
    seedIds: bracket.seeds.map((seed) => seed.uid),
  });
  await Promise.all(
    bracket.seeds.map((seed, index) =>
      sendPush(
        seed.uid,
        "Finals are set",
        `You're the ${index + 1} seed in the ${seasonName} finals. Check the bracket for your tie.`,
        { type: "finals_set", seasonId },
      ),
    ),
  );

  logger.info("startFinals", {
    seasonId,
    structure: bracket.structure,
    seedIds: bracket.seeds.map((seed) => seed.uid),
  });
  return { ok: true, bracket };
});

/**
 * Apply a decided finals tie to the bracket: mark the winner, open + deal the next ties,
 * emit the feed event, and notify newly matched players. Idempotent for replays of the
 * same match; a duplicate result for an already-decided slot is logged and ignored.
 */
export async function applyFinalsResult(args: {
  seasonId: string;
  slotKey: FinalsSlotKey;
  winnerId: string;
  matchId: string | null;
  decidedBy: FinalsDecidedBy;
  winnerGoals: number | null;
  loserGoals: number | null;
}): Promise<void> {
  const snap = await bracketRef(args.seasonId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "No finals bracket exists for this season.");
  }
  const raw = snap.data()!;
  const bracket = bracketFromSnap(raw);
  const slot = bracket.slots[args.slotKey];
  if (!slot) throw new HttpsError("not-found", `No slot ${args.slotKey} in this bracket.`);
  if (slot.status === "decided") {
    if (slot.matchId && slot.matchId === args.matchId) return;
    logger.warn("finals_slot_already_decided", { ...args, existingMatchId: slot.matchId });
    return;
  }

  let advanced;
  try {
    advanced = advanceBracket(bracket, args.slotKey, args.winnerId, args.matchId, args.decidedBy);
  } catch (error) {
    throw new HttpsError("failed-precondition", (error as Error).message);
  }
  await dealTeamsForSlots(advanced.bracket, advanced.opened, args.seasonId);

  await bracketRef(args.seasonId).set({
    ...raw,
    ...advanced.bracket,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const loserId = args.winnerId === slot.homeId ? slot.awayId! : slot.homeId!;
  await emitFinalsResultActivity({
    seasonId: args.seasonId,
    slotKey: args.slotKey,
    label: slot.label,
    round: slot.round,
    winnerId: args.winnerId,
    loserId,
    matchId: args.matchId,
    winnerGoals: args.winnerGoals,
    loserGoals: args.loserGoals,
    decidedBy: args.decidedBy,
  });

  for (const key of advanced.opened) {
    const next = advanced.bracket.slots[key];
    if (!next?.homeId || !next.awayId) continue;
    await Promise.all(
      [next.homeId, next.awayId].map((playerId) =>
        sendPush(
          playerId,
          `${next.label} is set`,
          `Your ${next.label} matchup is ready — equal teams dealt. Check the bracket.`,
          { type: "finals_tie_set", seasonId: args.seasonId, slot: key },
        ),
      ),
    );
  }
  logger.info("applyFinalsResult", { ...args, opened: advanced.opened });
}

/**
 * Admin walkover: decide an open tie without a match (absence, forfeit). The winner
 * advances exactly as if they had won on the console.
 */
export const awardWalkover = loggedOnCall("awardWalkover", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  const slotKey = String(req.data?.slot ?? "").trim() as FinalsSlotKey;
  const winnerId = String(req.data?.winnerId ?? "").trim();
  if (!seasonId || !slotKey || !winnerId)
    throw new HttpsError("invalid-argument", "seasonId, slot, and winnerId are required.");

  await applyFinalsResult({
    seasonId,
    slotKey,
    winnerId,
    matchId: null,
    decidedBy: "walkover",
    winnerGoals: null,
    loserGoals: null,
  });
  logger.info("awardWalkover", { seasonId, slotKey, winnerId, by: uid });
  return { ok: true };
});

export { bracketComplete };
