/**
 * IO layer for the finals prediction game. Members write their own picks doc directly
 * (firestore.rules allows owner-only writes, and only for slots that are still OPEN in
 * the bracket); this module settles scores server-side when a finals tie resolves.
 *
 * Settlement is invoked from finals.ts AFTER applyFinalsResult commits a bracket advance
 * (both the player-confirm and admin-resolve/walkover paths funnel through there). It
 * recomputes the whole season leaderboard from scratch — every picks doc measured against
 * every decided slot — which makes repeated settlements over a growing bracket naturally
 * idempotent. Pure math lives in predictionRules.ts.
 *
 * Late-edit integrity: the rules only accept a pick write while its slot is open, so a
 * decided slot's stored pick is frozen and provably pre-decision. No timestamp comparison
 * happens here — an earlier doc-level-stamp design retroactively erased earlier-round
 * picks whenever a member legitimately kept picking later rounds.
 */
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { captureServerFault } from "./sentry";
import type { FinalsSlotKey } from "./finalsRules";
import {
  buildScoreboard,
  type DecidedSlot,
  type PickDocInput,
  type ScoreboardEntry,
} from "./predictionRules";

const db = getFirestore();

/** The season's decided slots in bracket order. */
async function decidedSlots(dbRef: Firestore, seasonId: string): Promise<DecidedSlot[]> {
  const snap = await dbRef.doc(`seasons/${seasonId}/finals/bracket`).get();
  const rawSlots = (snap.get("slots") ?? {}) as Record<string, Record<string, unknown>>;
  const slots: DecidedSlot[] = [];
  for (const [key, raw] of Object.entries(rawSlots)) {
    if (raw?.status !== "decided") continue;
    slots.push({
      key: key as FinalsSlotKey,
      homeId: typeof raw.homeId === "string" ? raw.homeId : null,
      awayId: typeof raw.awayId === "string" ? raw.awayId : null,
      homeSeed: typeof raw.homeSeed === "number" ? raw.homeSeed : null,
      awaySeed: typeof raw.awaySeed === "number" ? raw.awaySeed : null,
      winnerId: typeof raw.winnerId === "string" ? raw.winnerId : null,
    });
  }
  return slots;
}

function pickDocsFrom(snapDocs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  return snapDocs.map((docSnap): PickDocInput => {
    const data = docSnap.data();
    const rawPicks =
      data.picks && typeof data.picks === "object" && !Array.isArray(data.picks)
        ? (data.picks as PickDocInput["picks"])
        : {};
    // The doc id IS the predictor: rules pin the field to it on every write, but older or
    // hand-edited docs get normalized here so attribution can't be spoofed at score time.
    return { predictorId: docSnap.id, picks: rawPicks, updatedAtMillis: null };
  });
}

/**
 * Settle the prediction game for a season: rebuild `finalsPredictions/{id}/scoreboard/leader`
 * from the current bracket and every member's picks doc. Call once per resolved slot, after
 * applyFinalsResult has committed. Safe to run again at any time — the write is a full replace.
 */
export async function scoreFinalsSlot(args: {
  seasonId: string;
  slotKey: FinalsSlotKey;
}): Promise<void> {
  const [slots, picksSnap, existing] = await Promise.all([
    decidedSlots(db, args.seasonId),
    db.collection(`finalsPredictions/${args.seasonId}/picks`).get(),
    db.doc(`finalsPredictions/${args.seasonId}/scoreboard/leader`).get(),
  ]);

  const entries: ScoreboardEntry[] = buildScoreboard(slots, pickDocsFrom(picksSnap.docs));
  // No pickers yet and no stale board to refresh — don't seed the collection with an
  // empty leader doc. Once picks exist the board is always rewritten, never deleted.
  if (entries.length === 0 && !existing.exists) return;

  await db.doc(`finalsPredictions/${args.seasonId}/scoreboard/leader`).set({
    updatedAt: FieldValue.serverTimestamp(),
    entries,
  });
  logger.info("finals_predictions_scored", {
    seasonId: args.seasonId,
    settledSlots: slots.length,
    predictors: entries.length,
  });
}

/**
 * Fire-and-forget settlement for the applyFinalsResult path. A scoring failure must never
 * fail match confirmation — the result itself is already committed — so everything is caught,
 * warned to Cloud Logging, and reported to Sentry here rather than at each call site.
 */
export async function scoreFinalsSlotOnApply(args: {
  seasonId: string;
  slotKey: FinalsSlotKey;
}): Promise<void> {
  try {
    await scoreFinalsSlot(args);
  } catch (error) {
    logger.warn("finals_predictions_scoring_failed", {
      seasonId: args.seasonId,
      slotKey: args.slotKey,
      error: error instanceof Error ? error.message : String(error),
    });
    // captureServerFault swallows its own failures; guarded again so a faulty capture
    // implementation can never break the confirmation flow this wrapper protects.
    try {
      await captureServerFault(error, { fn: "applyFinalsResult.predictions" });
    } catch {
      // Reporting must never mask the original failure.
    }
  }
}
