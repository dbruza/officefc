/**
 * Client data layer for the finals prediction game. Picks are written DIRECTLY by each
 * member to their own doc at `finalsPredictions/{seasonId}/picks/{uid}` (rules: owner-only
 * writes, fields exactly predictorId/picks/updatedAt) while the tie's slot is still open;
 * the scoreboard at `finalsPredictions/{seasonId}/scoreboard/leader` is function-written
 * and read-only here. Settlement happens server-side in functions/src/predictions.ts when
 * a finals match confirms — the scoring constants mirrored below (pickOutcome) exist only
 * for instant UI feedback and are never authoritative.
 */
import {
  doc,
  FirestoreError,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";
import type { FinalsSlot } from "./types";

export interface PredictionPick {
  /** Player the member backed to advance from this slot. */
  predictedWinnerId: string;
}

/** A member's picks doc: slotKey → pick. Absent key = no prediction made (yet). */
export interface FinalsPicks {
  picks: Record<string, PredictionPick>;
}

/** One row of the function-written leaderboard. */
export interface ScoreboardEntry {
  predictorId: string;
  points: number;
  correct: number;
  wrong: number;
}

/** Scoring constants — must mirror functions/src/predictionRules.ts. */
export const UPSET_POINTS = 2;
export const FAVOURITE_POINTS = 1;

/**
 * Whether backing `predictedWinnerId` counts as an upset call (2 points over 1). The
 * higher seed number is the weaker side; equal or unknown seeds mean no favourite, so any
 * correct call counts as upset-worthy (mirrors isUpsetCall server-side).
 */
export function isUpsetCall(slot: FinalsSlot, predictedWinnerId: string): boolean {
  const { homeSeed, awaySeed } = slot;
  if (homeSeed == null || awaySeed == null || homeSeed === awaySeed) return true;
  const winnerSeed = predictedWinnerId === slot.homeId ? homeSeed : awaySeed;
  return winnerSeed > (predictedWinnerId === slot.homeId ? awaySeed : homeSeed);
}

/**
 * Result of one of the member's picks: `decided` is true once the tie has a winner AND a
 * pick exists to grade it (`correct` then says which way it went); an open tie or an
 * unpicked decided tie reports not-decided, and points are 0 unless the pick was right.
 */
export function pickOutcome(
  slot: FinalsSlot,
  pick: PredictionPick | undefined,
): { decided: boolean; correct: boolean; points: number } {
  if (!slot.winnerId || !pick) return { decided: false, correct: false, points: 0 };
  if (pick.predictedWinnerId !== slot.winnerId) {
    return { decided: true, correct: false, points: 0 };
  }
  return {
    decided: true,
    correct: true,
    points: isUpsetCall(slot, pick.predictedWinnerId) ? UPSET_POINTS : FAVOURITE_POINTS,
  };
}

/** True only while the tie can still be predicted — pending slots have no participants. */
export function slotIsPredictable(slot: FinalsSlot): boolean {
  return slot.status === "open";
}

function mapScoreboardEntry(raw: unknown): ScoreboardEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.predictorId !== "string") return null;
  return {
    predictorId: entry.predictorId,
    points: typeof entry.points === "number" && Number.isFinite(entry.points) ? entry.points : 0,
    correct:
      typeof entry.correct === "number" && Number.isFinite(entry.correct) ? entry.correct : 0,
    wrong: typeof entry.wrong === "number" && Number.isFinite(entry.wrong) ? entry.wrong : 0,
  };
}

/** The signed-in member's picks for a season; empty map before their first prediction. */
export async function getMyFinalsPicks(seasonId: string, uid: string): Promise<FinalsPicks> {
  // Read failure degrades to "no picks" — the predictions section is decoration on the
  // finals screen and a transient error (or rules not yet deployed) must not kill it.
  const snap = await getDoc(doc(db, "finalsPredictions", seasonId, "picks", uid)).catch(() => null);
  if (!snap || !snap.exists()) return { picks: {} };
  const data = snap.data();
  return {
    picks:
      data.picks && typeof data.picks === "object" && !Array.isArray(data.picks)
        ? (data.picks as FinalsPicks["picks"])
        : {},
  };
}

/** The season's prediction league table (entries already sorted by the writer). */
export async function getFinalsScoreboard(seasonId: string): Promise<ScoreboardEntry[]> {
  return timed("getFinalsScoreboard", async () => {
    // Same degrade-to-empty contract as getMyFinalsPicks above.
    const snap = await getDoc(doc(db, "finalsPredictions", seasonId, "scoreboard", "leader")).catch(
      () => null,
    );
    if (!snap || !snap.exists()) return [];
    const entries = snap.get("entries");
    if (!Array.isArray(entries)) return [];
    return entries
      .map(mapScoreboardEntry)
      .filter((entry): entry is ScoreboardEntry => entry != null);
  });
}

/**
 * Save one prediction into the member's picks doc. Writes go through the per-slot field
 * path (`picks.{slotKey}`) so sibling picks survive untouched — a whole-map merge would
 * erase them, and rules require every pick in the map to name an OPEN slot anyway.
 * Refuses non-open slots client-side to mirror the rules contract: once a tie is decided
 * its slot closes server-side and the pick is frozen.
 */
export async function saveFinalsPick(
  seasonId: string,
  uid: string,
  slot: FinalsSlot,
  predictedWinnerId: string,
): Promise<void> {
  if (!slotIsPredictable(slot)) {
    throw new Error(`${slot.label} is locked — predictions closed.`);
  }
  const ref = doc(db, "finalsPredictions", seasonId, "picks", uid);
  // update first so an existing doc keeps its other picks; falls back to create when
  // this is the member's very first pick of the season (update fails on missing docs).
  try {
    await updateDoc(ref, {
      [`picks.${slot.key}`]: { predictedWinnerId },
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (error instanceof FirestoreError && error.code === "not-found") {
      await setDoc(ref, {
        predictorId: uid,
        picks: { [slot.key]: { predictedWinnerId } },
        updatedAt: serverTimestamp(),
      });
      return;
    }
    // The slot's tie may have been decided while the screen was open: rules reject
    // writes to closed slots with permission-denied. Translate that into the same
    // friendly lock message the stale-open check produces.
    if (error instanceof FirestoreError && error.code === "permission-denied") {
      throw new Error(`${slot.label} is locked — predictions closed.`);
    }
    throw error;
  }
}
