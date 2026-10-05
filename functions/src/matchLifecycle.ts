import { schedulePendingMatch } from "./scheduling";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { loggedOnCall } from "./logging";
import { instrumentBackground, captureServerFault } from "./sentry";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { requireAuth, assertAdmin, assertMember } from "./auth";
import { requestRebuild, enqueueRebuild } from "./rebuildQueue";
import { applyFinalsResult } from "./finals";
import type { FinalsDecidedBy, FinalsSlotKey } from "./finalsRules";
import { maybeConsumeCupResult } from "./cup";
import { sendPush } from "./notify";
import { canAutoConfirm, responderRejection } from "./matchRules";
import { BLOCKED_MATCH_MESSAGE, isBlockedBetween } from "./members";

/** `confirmedBy` marker for a result the dispute-window scheduler confirmed, not a player.
 *  Distinguishes auto-accepted matches from genuine confirmations in the audit trail. */
export const AUTO_CONFIRMER = "auto";

/**
 * Refuse to confirm into a season whose results are already published. finalizeSeason
 * snapshots champion/premier from the standings; a confirm (or admin resolve) that lands
 * afterwards would rewrite ELO and tables with no re-publication — exactly what the
 * auto-confirm scheduler refuses to do for a finalized season. Transaction-scoped so the
 * season read joins the caller's transaction: a confirm that reads finalized=false and a
 * finalize that publishes later are serialized by the caller's own match write, and the
 * post-commit rebuild is re-checked against the season doc before it runs.
 */
export async function assertSeasonAcceptsConfirmationsTx(
  tx: FirebaseFirestore.Transaction,
  seasonId: string,
): Promise<void> {
  const snap = await tx.get(getFirestore().doc(`seasons/${seasonId}`));
  if (!snap.exists) throw new HttpsError("not-found", "Match's season no longer exists.");
  // Truthy check matches startFinals / finalizeSeason / activateSeason.
  if (snap.get("finalized")) {
    throw new HttpsError(
      "failed-precondition",
      "This season is finalized — its results can no longer change.",
    );
  }
}

export interface ConfirmResult {
  seasonId: string;
  submittedBy: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  finals: boolean;
  finalsSlot: string | null;
  decidedBy: string | null;
}

/** Read a confirmed match's fields into the shape the post-confirmation work needs. */
function toConfirmResult(data: FirebaseFirestore.DocumentData): ConfirmResult {
  return {
    seasonId: String(data.seasonId),
    submittedBy: String(data.submittedBy),
    aId: String(data.aId),
    bId: String(data.bId),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    finals: data.finals === true,
    finalsSlot: typeof data.finalsSlot === "string" ? data.finalsSlot : null,
    decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : null,
  };
}

/**
 * Advance the bracket for a confirmed finals match. Finals decide the bracket and never move
 * ELO or the table, so this is the whole of their post-confirmation work.
 *
 * Returns false when the slot had already been decided by another result (a concurrent admin
 * resolve or walkover won it) — the caller must not tell players the result was applied.
 */
async function applyFinalsConfirmation(result: ConfirmResult, matchId: string): Promise<boolean> {
  // Rules guarantee no draws in finals, so the higher score is the winner.
  const winnerId = result.aGoals > result.bGoals ? result.aId : result.bId;
  const outcome = await applyFinalsResult({
    seasonId: result.seasonId,
    slotKey: result.finalsSlot as FinalsSlotKey,
    winnerId,
    matchId,
    decidedBy: (result.decidedBy ?? "regulation") as FinalsDecidedBy,
    winnerGoals: Math.max(result.aGoals, result.bGoals),
    loserGoals: Math.min(result.aGoals, result.bGoals),
  });
  return outcome !== "superseded";
}

/**
 * Everything that must happen once a single match is status-confirmed — ELO/tables, league
 * stats, activity feed, bracket for finals — plus a push to the submitter. Used by the manual
 * confirmMatch callable. The scheduler deliberately does NOT use this: it confirms a batch and
 * rebuilds the read models once for the whole batch (see finalizeAutoConfirmedBatch).
 */
export async function finalizeConfirmation(
  result: ConfirmResult,
  matchId: string,
  pushTitle: string,
  pushBody: string,
): Promise<void> {
  // Cup advancement runs for BOTH paths below: cup games count toward ELO/stats like any
  // other match (unlike finals, which are excluded from the recalc pipeline), and the tie
  // consumption is a pure read-model over confirmed results. Failure must never fail the
  // confirmation itself — an admin can force-advance a missed tie.
  try {
    await maybeConsumeCupResult({
      seasonId: result.seasonId,
      aId: result.aId,
      bId: result.bId,
      aGoals: result.aGoals,
      bGoals: result.bGoals,
    });
  } catch (error) {
    logger.warn("cup_consume_failed", {
      matchId,
      seasonId: result.seasonId,
      error: error instanceof Error ? error.message : String(error),
    });
    await captureServerFault(error, { fn: "maybeConsumeCupResult" });
    // Cup state writes have their own replayable announcement trigger.
  }

  if (result.finals && result.finalsSlot) {
    const applied = await applyFinalsConfirmation(result, matchId);
    if (!applied) {
      // The slot was decided by another result while this confirmation was in flight. The
      // match doc is still confirmed (correct — it was a legal result), but the bracket took
      // the other one. Tell the submitter the truth instead of claiming it's in the bracket.
      logger.warn("finals_confirm_lost_slot_race", { matchId, seasonId: result.seasonId });
      await sendPush(
        result.submittedBy,
        "Match confirmed",
        `Your ${result.aGoals}-${result.bGoals} result is recorded, but that tie had already been decided.`,
        { type: "match_confirmed", matchId },
      );
      return;
    }
    await sendPush(result.submittedBy, pushTitle, pushBody, {
      type: "match_confirmed",
      matchId,
    });
    return;
  }

  await sendPush(result.submittedBy, pushTitle, pushBody, { type: "match_confirmed", matchId });
}

/** A match the scheduler flipped to confirmed, paired with its id for the batch finalize. */
export interface AutoConfirmed {
  matchId: string;
  result: ConfirmResult;
}

/**
 * Flip one pending match to confirmed on the opponent's behalf, in a transaction that re-checks
 * eligibility against the same cutoff the caller filtered on. Marked with the `auto` system
 * marker plus an `autoConfirmedAt` timestamp for auditability. Deliberately not a public
 * callable — there is no unauthenticated way to confirm a match.
 *
 * Returns the confirmed match's fields, or null when it was no longer eligible — the opponent
 * confirmed or disputed it first, a previous run already handled it, or its age can't be proven.
 * Performs NO read-model work: the caller batches that so one scheduled run rebuilds the tables
 * once, not once per match.
 */
export async function autoConfirmMatch(
  matchId: string,
  cutoffMillis: number,
  floorMillis?: number,
): Promise<ConfirmResult | null> {
  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  return db.runTransaction(async (tx): Promise<ConfirmResult | null> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    // Re-check inside the transaction: status may have changed since the query, and the age
    // rule is enforced here too so a match can never confirm without its full dispute window.
    if (!canAutoConfirm(data, cutoffMillis, floorMillis)) return null;
    // Same finalized-season guard as confirmMatch: finalizeSeason may commit between the
    // scheduler's season query and this flip. Throwing here leaves the match pending for the
    // next run and lands in the caller's auto_confirm_flip_failed log — correct, because a
    // confirmed-but-unpublished result is exactly what the heal logic refuses to paper over.
    await assertSeasonAcceptsConfirmationsTx(tx, String(data.seasonId));
    tx.update(ref, {
      status: "confirmed",
      confirmedBy: AUTO_CONFIRMER,
      autoConfirmedAt: FieldValue.serverTimestamp(),
      confirmedAt: FieldValue.serverTimestamp(),
    });
    requestRebuild(tx, String(data.seasonId), {
      matchId,
      result: toConfirmResult(data),
      mode: "auto",
    });
    return toConfirmResult(data);
  });
}

/**
 * Seasons whose read models still need rebuilding after an auto-confirm. A match is flipped to
 * `confirmed` in its own transaction and the tables are rebuilt afterwards, so a crash in
 * between would otherwise leave the match confirmed but absent from the standings — and the
 * next run would skip it, because it is no longer pending. Recording the season here before
 * the rebuild, and clearing it only on success, lets the following run heal that drift.
 */
const AUTO_CONFIRM_STATE_DOC = "systemState/autoConfirm";

/** Seasons recorded as needing a rebuild by an earlier run that didn't finish one. */
export async function pendingRecalcSeasonIds(): Promise<string[]> {
  const snap = await getFirestore().doc(AUTO_CONFIRM_STATE_DOC).get();
  const ids = snap.get("pendingSeasonIds");
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Stamp the moment auto-confirmation became live, and return it. The first run records `now`;
 * every later run reads that same value back.
 *
 * Callers wait a full dispute window past this point before confirming anything. Without it,
 * the first run after deploy would sweep up every match already sitting pending — results
 * submitted under rules that said nothing about auto-confirmation, whose opponents were never
 * warned — and lock them all in within ten minutes of release.
 */
export async function armAutoConfirm(nowMillis: number): Promise<number> {
  const db = getFirestore();
  const ref = db.doc(AUTO_CONFIRM_STATE_DOC);
  return db.runTransaction(async (tx): Promise<number> => {
    const snap = await tx.get(ref);
    const existing = snap.get("armedAt");
    if (typeof existing === "number") return existing;
    tx.set(ref, { armedAt: nowMillis, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return nowMillis;
  });
}

/**
 * Record that a season will have matches confirmed into it, BEFORE any match is flipped. The
 * flip and the rebuild can't share a transaction (the rebuild reads the very matches the flip
 * writes), so this marker is what makes the pair recoverable: if anything between here and a
 * successful rebuild fails, the next run sees the season and rebuilds it.
 */
export async function markSeasonRecalcPending(seasonIds: string[]): Promise<void> {
  if (seasonIds.length === 0) return;
  const db = getFirestore();
  await db.doc(AUTO_CONFIRM_STATE_DOC).set(
    {
      pendingSeasonIds: FieldValue.arrayUnion(...seasonIds),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** What one auto-confirm run actually managed to do, for the caller's log line. */
export interface FinalizeOutcome {
  rebuilt: string[];
  /** Marked seasons that can never be rebuilt (deleted, or finalized since being marked). */
  discarded: string[];
  recalcFailed: number;
  activityFailed: number;
  pushFailed: number;
  cupFailed: number;
}

/**
 * Post-confirmation work for a batch of auto-confirmed matches: rebuild each affected season's
 * ELO once and the league-wide read models once, rather than once per match. Both participants
 * are notified — the submitter that their result landed, and the opponent that their silence
 * confirmed it. Finals never reach here (see `canAutoConfirm`).
 *
 * `healSeasonIds` are seasons a previous run flagged as needing a rebuild; they are folded into
 * this run's recalc even when no match from them was confirmed now.
 *
 * Every per-item step is isolated. One player's failed push or one season's failed recalc must
 * not cost every later item in the batch its notification — those are the messages telling
 * someone a result was locked in without their consent, and nothing replays them.
 */
export async function finalizeAutoConfirmedBatch(
  _batch: AutoConfirmed[],
  healSeasonIds: string[] = [],
): Promise<FinalizeOutcome> {
  const db = getFirestore();
  const outcome: FinalizeOutcome = {
    rebuilt: [],
    discarded: [],
    recalcFailed: 0,
    activityFailed: 0,
    pushFailed: 0,
    cupFailed: 0,
  };
  for (const id of new Set(healSeasonIds)) {
    const season = await db.doc(`seasons/${id}`).get();
    if (!season.exists || season.get("finalized")) outcome.discarded.push(id);
    else await enqueueRebuild(id);
  }
  // The atomic queue now owns recovery, so the previous scheduler's markers can be retired.
  if (healSeasonIds.length)
    await db
      .doc(AUTO_CONFIRM_STATE_DOC)
      .set({ pendingSeasonIds: FieldValue.arrayRemove(...healSeasonIds) }, { merge: true });
  return outcome;
}

/** Only the named opponent can confirm a pending match. */
export const confirmMatch = loggedOnCall("confirmMatch", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    // Authorization before state: a non-opponent gets permission-denied, not a hint about
    // the season's lifecycle. The finalized guard only runs for callers with skin in the game.
    const rejection = responderRejection(data, uid);
    if (rejection === "not_opponent") {
      throw new HttpsError("permission-denied", "Only the named opponent can confirm.");
    }
    if (rejection === "not_pending") {
      throw new HttpsError("failed-precondition", "This match is no longer pending.");
    }
    // In-transaction so the season read is consistent with the match write.
    await assertSeasonAcceptsConfirmationsTx(tx, String(data.seasonId));
    tx.update(ref, {
      status: "confirmed",
      confirmedBy: uid,
      confirmedAt: FieldValue.serverTimestamp(),
    });
    requestRebuild(tx, String(data.seasonId), {
      matchId,
      result: toConfirmResult(data),
      mode: "manual",
    });
    return toConfirmResult(data);
  });

  return { ok: true, updating: true, seasonId: result.seasonId };
});

/** The named opponent may dispute a pending match; disputed matches never affect ELO. */
export const disputeMatch = loggedOnCall("disputeMatch", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const matchId = String(req.data?.matchId ?? "").trim();
  const reason = String(req.data?.reason ?? "")
    .trim()
    .slice(0, 240);
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  const submittedBy = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    const rejection = responderRejection(data, uid);
    if (rejection === "not_opponent") {
      throw new HttpsError("permission-denied", "Only the named opponent can dispute.");
    }
    if (rejection === "not_pending") {
      throw new HttpsError("failed-precondition", "This match is no longer pending.");
    }
    tx.update(ref, {
      status: "disputed",
      disputedBy: uid,
      disputeReason: reason || null,
      disputedAt: FieldValue.serverTimestamp(),
    });
    return String(data.submittedBy);
  });

  await sendPush(submittedBy, "Match disputed", "Your opponent flagged a submitted result.", {
    type: "match_disputed",
    matchId,
  });
  return { ok: true };
});

/**
 * Notify the opponent when any valid client creates a pending match. A match between a
 * blocked pair is voided instead: the rules can't check blocks (they'd exceed the
 * per-request document-read budget), so this is where client-created matches are held to it.
 */
export const notifyMatchSubmitted = onDocumentCreated(
  { document: "matches/{matchId}", retry: true },
  instrumentBackground("notifyMatchSubmitted", async (event) => {
    const created = event.data?.data();
    if (
      event.data &&
      created?.status === "pending_confirmation" &&
      (await isBlockedBetween(String(created.aId), String(created.bId)))
    ) {
      await event.data.ref.update({
        status: "voided",
        resolution: "voided",
        resolvedBy: "system",
        resolvedAt: FieldValue.serverTimestamp(),
        resolutionReason: BLOCKED_MATCH_MESSAGE,
        previousStatus: created.status,
      });
      return;
    }
    if (event.data) await schedulePendingMatch(event.data.ref);
    const data = event.data?.data();
    if (!data || data.status !== "pending_confirmation") return;
    const opponentId = data.submittedBy === data.aId ? data.bId : data.aId;
    if (typeof opponentId !== "string") return;
    await sendPush(
      opponentId,
      "Result needs your nod",
      `Confirm or dispute the ${data.aGoals}-${data.bGoals} score.`,
      { type: "match_pending", matchId: event.params.matchId },
    );
  }),
);

/** Delete a match photo from storage and clear the reference. Submitter, or an admin moderating. */
export const deleteMatchPhoto = loggedOnCall("deleteMatchPhoto", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "matchId is required.");
  const moderator = await isAdminUid(uid);

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    if (data.submittedBy !== uid && !moderator)
      throw new HttpsError("permission-denied", "Only the submitter can delete their photo.");
    const photoPath = String(data.photoPath ?? "");
    if (!photoPath) throw new HttpsError("not-found", "No photo stored for this match.");

    const bucket = getStorage().bucket();
    const [exists] = await bucket.file(photoPath).exists();
    if (exists) await bucket.file(photoPath).delete();

    tx.update(ref, {
      photoPath: FieldValue.delete(),
      photoDeletedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, matchId };
});

async function isAdminUid(uid: string): Promise<boolean> {
  try {
    await assertAdmin(uid);
    return true;
  } catch {
    return false;
  }
}
