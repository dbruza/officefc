/**
 * IO layer for the mid-season knockout cup. State lives in ONE document,
 * `seasons/{id}/cup/state` (member-readable via the seasons subtree rules; all writes
 * happen here via the Admin SDK) — the rules grant no new collections, so a subcollection
 * doc under seasons is the whole of our storage budget.
 *
 * Cup games COUNT toward league ELO/stats like any other logged match (v1 decision): this
 * module never recalculates anything and never touches match docs. Advancement is a pure
 * read-model over confirmed results — maybeConsumeCupResult watches confirmed matches and
 * advances the matching tie.
 */
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loggedOnCall } from "./logging";
import { requireAuth, assertAdmin } from "./auth";
import { LEAGUE_ID } from "./config";
import {
  advance,
  cupChampion,
  drawBracket,
  forceAdvanceAt,
  fromStoredRounds,
  isComplete,
  toStoredRounds,
  type CupBracket,
} from "./cupRules";
import { sendPush } from "./notify";

const db = getFirestore();

function cupRef(seasonId: string) {
  return db.doc(`seasons/${seasonId}/cup/state`);
}

function bracketFromSnap(data: Record<string, unknown>): CupBracket {
  // Written only by this module; validated shallowly so a hand-edited doc fails loudly
  // instead of advancing into a corrupt bracket.
  const bracket = fromStoredRounds(data.rounds);
  if (!bracket) throw new HttpsError("data-loss", "Cup state is corrupt.");
  return bracket;
}

/** Firestore error code for a transaction that kept losing contention (gRPC ABORTED). */
const GRPC_ABORTED = 10;

/**
 * Start a mid-season knockout cup from the league roster. Refuses a finalized season (its
 * results are published and frozen), a season that isn't active, a season that already has
 * ANY cup (a completed cup's bracket is history — restarting would wipe it), and rosters
 * too small for a meaningful bracket. The whole create runs in a transaction so two admins
 * tapping at once cannot silently replace each other's draw; the roster is sorted so the
 * stored seed reproduces the exact draw regardless of Firestore read order.
 */
export const startCup = loggedOnCall("startCup", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");

  const seasonSnap = await db.doc(`seasons/${seasonId}`).get();
  if (!seasonSnap.exists) throw new HttpsError("not-found", "Season not found.");
  if (seasonSnap.get("finalized")) {
    throw new HttpsError("failed-precondition", "Season is already finalized.");
  }
  if (seasonSnap.get("active") !== true) {
    throw new HttpsError("failed-precondition", "Cups can only start on the active season.");
  }

  const membersSnap = await db.collection(`leagues/${LEAGUE_ID}/members`).get();
  // Sorted ids make the draw reproducible from the stored seed alone — Firestore gives
  // collection reads no order guarantee, so the raw read order must never feed the shuffle.
  const memberIds = membersSnap.docs.map((doc) => doc.id).sort();
  if (memberIds.length < 3) {
    throw new HttpsError("failed-precondition", "A cup needs at least 3 members.");
  }

  // Date-derived seed: unpredictable enough that the draw feels random, small enough to
  // stay an exact int64 on the doc for reproducibility.
  const seed = Date.now() >>> 0;
  const rounds = drawBracket(memberIds, seed);

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(cupRef(seasonId));
      if (existing.exists) {
        // Any existing state — live OR complete — blocks a restart: a finished bracket is
        // league history, and overwriting a live one would strand ties already played.
        throw new HttpsError(
          existing.get("status") === "live" ? "failed-precondition" : "already-exists",
          existing.get("status") === "live"
            ? "This season already has a live cup."
            : "This season's cup has already been played.",
        );
      }
      tx.set(cupRef(seasonId), {
        status: "live",
        rounds: toStoredRounds(rounds),
        seed,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      });
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    // A transaction that exhausted its retries against a concurrent create surfaces as the
    // same precondition the second caller would have seen had it read after the first one
    // committed. Anything else is a real failure — report it as one rather than claiming a
    // cup exists (that mislabel hid the nested-array write rejection for every draw).
    if ((error as { code?: unknown })?.code === GRPC_ABORTED) {
      throw new HttpsError("failed-precondition", "This season already has a cup.");
    }
    logger.error("startCup_write_failed", {
      seasonId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError("internal", "Couldn't start the cup. Try again.");
  }

  logger.info("startCup", { seasonId, seed, entrants: memberIds.length });
  return { ok: true };
});

/**
 * Admin override for a stuck OPEN tie (a player away, a result that never landed): decide
 * tie (roundIndex, tieIndex) for winnerId and propagate, exactly as a confirmed result
 * would have. Already-decided ties are refused — a voided-after-consumption tie can't be
 * repaired here because its winner already occupies later-round slots; that needs direct
 * bracket surgery in the Firebase console.
 */
export const forceAdvanceCup = loggedOnCall("forceAdvanceCup", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  const roundIndex = Number(req.data?.roundIndex);
  const tieIndex = Number(req.data?.tieIndex);
  const winnerId = String(req.data?.winnerId ?? "").trim();
  if (!seasonId || !winnerId || !Number.isInteger(roundIndex) || !Number.isInteger(tieIndex)) {
    throw new HttpsError(
      "invalid-argument",
      "seasonId, roundIndex, tieIndex, and winnerId are required.",
    );
  }

  await db.runTransaction(async (tx) => {
    const ref = cupRef(seasonId);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("status") !== "live") {
      throw new HttpsError("failed-precondition", "No live cup exists for this season.");
    }
    // Re-read INSIDE the transaction: a concurrent consumption may have just decided this
    // tie, and overwriting it would resurrect an eliminated player.
    let advanced: CupBracket;
    try {
      advanced = forceAdvanceAt(bracketFromSnap(snap.data()!), roundIndex, tieIndex, winnerId);
    } catch (error) {
      throw new HttpsError("failed-precondition", (error as Error).message);
    }
    tx.set(ref, {
      ...snap.data()!,
      rounds: toStoredRounds(advanced),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // The bracket write above has committed either way — a push failure must not surface to
  // the admin as a failed advance.
  try {
    await announceChampionIfComplete(seasonId);
  } catch (error) {
    logger.warn("cup_champion_announce_failed", {
      seasonId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.info("forceAdvanceCup", { seasonId, roundIndex, tieIndex, winnerId, by: uid });
  return { ok: true };
});

/**
 * Push "wins the cup" to every member once. The status flip to "complete" happens inside
 * the SAME transaction that decided the final tie, so two racing callers (a confirmed
 * result and a force-advance landing together) can't both pass the guard — only the one
 * whose write flipped live→complete sends.
 */
async function announceChampionIfComplete(seasonId: string): Promise<void> {
  const snap = await db.runTransaction(async (tx) => {
    const ref = cupRef(seasonId);
    const current = await tx.get(ref);
    if (!current.exists || current.get("status") !== "live") return null;
    const bracket = bracketFromSnap(current.data()!);
    const championId = cupChampion(bracket);
    if (!championId || !isComplete(bracket)) return null;
    tx.set(ref, {
      ...current.data()!,
      status: "complete",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { championId };
  });

  if (!snap) return;
  const { championId } = snap;
  const championProfile = await db.doc(`profiles/${championId}`).get();
  const championName = String(championProfile.get("displayName") ?? championId);
  const membersSnap = await db.collection(`leagues/${LEAGUE_ID}/members`).get();
  await Promise.all(
    membersSnap.docs.map((doc) =>
      sendPush(doc.id, "Cup decided", `🏆 ${championName} wins the cup!`, {
        type: "cup",
        seasonId,
      }),
    ),
  );
}

export interface CupMatchInput {
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  seasonId: string;
}

/**
 * Advance a live cup if this confirmed match is the first unresolved tie between these two
 * players. Runs its OWN transaction AFTER the caller's confirm transaction commits (the two
 * can't share one: the confirm tx writes the very match doc this reads as settled).
 *
 * Winner = higher goalscorer. A drawn score cannot consume a tie — the tie simply stays
 * open until a decider (replay) or an admin force-advance.
 *
 * PAIR CAVEAT (accepted v1 tradeoff): matching is by PAIR ONLY, not by competition — if the
 * two paired players log a LEAGUE match while their cup tie is open, that result advances
 * the cup too. Same office, same two controllers, same stakes either way.
 *
 * VOID LIMITATION (v1): voiding a match that already advanced a cup tie does NOT rewind the
 * bracket — undoing propagation through later rounds isn't modeled, and forceAdvanceCup
 * only decides OPEN ties. Repairing a consumed-then-voided tie means direct bracket edits
 * in the Firebase console. Named explicitly in matchLifecycle where voids pass through.
 */
export async function maybeConsumeCupResult(input: CupMatchInput): Promise<void> {
  const pre = await cupRef(input.seasonId).get();
  if (!pre.exists || pre.get("status") !== "live") return;

  const winnerId =
    input.aGoals > input.bGoals ? input.aId : input.bGoals > input.aGoals ? input.bId : null;
  if (!winnerId) return;

  const applied = await db.runTransaction(async (tx): Promise<boolean> => {
    const snap = await tx.get(cupRef(input.seasonId));
    if (!snap.exists || snap.get("status") !== "live") return false;
    let advanced: CupBracket;
    try {
      advanced = advance(bracketFromSnap(snap.data()!), input.aId, input.bId, winnerId);
    } catch {
      // No open tie for this pair — another result already advanced it (lost race) or the
      // pair has none. Either way nothing to apply; not an error for the confirmer.
      return false;
    }
    tx.set(cupRef(input.seasonId), {
      ...snap.data()!,
      rounds: toStoredRounds(advanced),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!applied) return;
  logger.info("cup_tie_consumed", {
    seasonId: input.seasonId,
    aId: input.aId,
    bId: input.bId,
    winnerId,
  });
  await announceChampionIfComplete(input.seasonId);
}
