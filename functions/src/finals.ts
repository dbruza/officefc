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

/** Everything team-dealing needs for one season, preloaded outside any transaction —
 *  the queries behind it are ordinary reads that inform team variety only, not
 *  correctness, so they must never re-run inside a bracket transaction's retry loop. */
type DealingContext = Awaited<ReturnType<typeof loadDealingContext>>;

/** Deal equal-OVR teams to every listed slot. Both sides are fed the same rating on
 *  purpose: finals are decided on skill, so the target OVR gap is zero regardless of the
 *  players' actual ELO. Recent teams (including earlier finals ties) are still avoided. */
async function dealTeamsForSlots(
  bracket: FinalsBracket,
  slotKeys: FinalsSlotKey[],
  { pool, seasonMatchesByDateDesc }: DealingContext,
): Promise<void> {
  if (slotKeys.length === 0) return;
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
  await dealTeamsForSlots(bracket, openSlots, await loadDealingContext(seasonId));

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
 * same match.
 *
 * Returns "applied" when this call decided the slot, "replay" when that exact match was
 * already applied, or "superseded" when another result won the race for the slot — callers
 * use it to avoid claiming success (or pushing players) about a result that was discarded.
 */
export async function applyFinalsResult(args: {
  seasonId: string;
  slotKey: FinalsSlotKey;
  winnerId: string;
  matchId: string | null;
  decidedBy: FinalsDecidedBy;
  winnerGoals: number | null;
  loserGoals: number | null;
}): Promise<"applied" | "replay" | "superseded"> {
  // Preload team-dealing data OUTSIDE the transaction: these are ordinary collection reads
  // that inform team variety only, not correctness, so they must not re-run on contention
  // retries or hold the bracket doc's lock window open while they run.
  const dealing = await loadDealingContext(args.seasonId);

  // Split literal members rather than a nested union — TS narrows per-literal reliably.
  type Decided =
    | { outcome: "replay" }
    | { outcome: "superseded" }
    | {
        outcome: "applied";
        preAdvanceSlot: FinalsSlot;
        advanced: ReturnType<typeof advanceBracket>;
      };

  const decided = await db.runTransaction(async (tx): Promise<Decided> => {
    const snap = await tx.get(bracketRef(args.seasonId));
    if (!snap.exists) {
      throw new HttpsError("not-found", "No finals bracket exists for this season.");
    }
    const raw = snap.data()!;
    const bracket = bracketFromSnap(raw);
    const slot = bracket.slots[args.slotKey];
    if (!slot) throw new HttpsError("not-found", `No slot ${args.slotKey} in this bracket.`);
    if (slot.status === "decided") {
      // Another caller's result won this slot, or this exact match was replayed. Logged by
      // the caller after commit so retries don't re-emit the warning.
      return {
        outcome: slot.matchId && slot.matchId === args.matchId ? "replay" : "superseded",
      };
    }

    let advanced: ReturnType<typeof advanceBracket>;
    try {
      advanced = advanceBracket(bracket, args.slotKey, args.winnerId, args.matchId, args.decidedBy);
    } catch (error) {
      throw new HttpsError("failed-precondition", (error as Error).message);
    }
    // Deal before the write so no client ever observes an open slot without teams
    // (same ordering as startFinals). The context was preloaded above — no queries here.
    dealTeamsForSlots(advanced.bracket, advanced.opened, dealing);

    tx.set(bracketRef(args.seasonId), {
      ...raw,
      ...advanced.bracket,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { outcome: "applied", preAdvanceSlot: slot, advanced };
  });

  // Nothing else to do for a replay of an already-applied result or a lost slot race —
  // side effects below must not run, and superseded is logged once here (not inside the
  // transaction, so retries don't re-emit it).
  if (decided.outcome === "superseded") {
    logger.warn("finals_slot_already_decided", { ...args });
    return "superseded";
  }
  if (decided.outcome === "replay") return "replay";

  const { preAdvanceSlot: slot, advanced } = decided;

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
  logger.info("applyFinalsResult", { ...args, opened: advanced.opened, outcome: "applied" });
  return "applied";
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

  const outcome = await applyFinalsResult({
    seasonId,
    slotKey,
    winnerId,
    matchId: null,
    decidedBy: "walkover",
    winnerGoals: null,
    loserGoals: null,
  });
  if (outcome === "superseded") {
    // The slot was decided by a real result while we were working — a walkover must not
    // claim to have overridden it, and the admin needs to know nothing was applied.
    throw new HttpsError(
      "failed-precondition",
      `Slot ${slotKey} was already decided by another result.`,
    );
  }
  logger.info("awardWalkover", { seasonId, slotKey, winnerId, by: uid, outcome });
  return { ok: true };
});

export { bracketComplete };
