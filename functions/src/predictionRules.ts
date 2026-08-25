/**
 * Pure scoring rules for the finals prediction game. No Firestore dependency — the IO
 * layer in predictions.ts feeds it the decided slots and every member's picks doc, then
 * persists the resulting leaderboard. Mirrored client-side in
 * mobile/src/lib/league/predictions.ts (pickOutcome) for instant UI feedback; the
 * server settlement is authoritative.
 *
 * Scoring: a correct pick earns 2 points when it backs the LOWER seed of the tie (an
 * "upset" call — AFL convention, the higher seed hosts and is expected to win), and
 * 1 point for backing the favourite. Equal seeds have no favourite, so any correct
 * winner counts as upset-worthy; the same applies when a side's seed is unknown (fed
 * slots carry only the fixed seed on their seeded side). A wrong pick scores 0.
 * Walkovers need no special case — scoring only ever looks at the slot's winnerId.
 *
 * Late-edit integrity lives in firestore.rules, not here: a pick may only be WRITTEN
 * while its bracket slot is open, so any pick present at settlement time was provably
 * made before the result existed. There is deliberately no timestamp comparison — a
 * doc-level stamp cannot tell WHICH slot an edit touched, and the previous attempt
 * (updatedAt vs confirmedAt) retroactively erased legitimate earlier-round picks the
 * moment a member kept playing.
 */

import type { FinalsSlotKey } from "./finalsRules";

export const UPSET_POINTS = 2;
export const FAVOURITE_POINTS = 1;

/** The slot fields scoring needs — a subset of finalsRules.FinalsSlot. */
export interface PredictableSlot {
  homeId: string | null;
  awayId: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
}

/** A settled tie: everything above plus who advanced. */
export interface DecidedSlot extends PredictableSlot {
  key: FinalsSlotKey;
  winnerId: string | null;
}

/** One entry of a member's picks map, as stored under `picks.{slotKey}` on their doc. */
export interface PredictionPick {
  predictedWinnerId: string;
}

/**
 * Whether backing `predictedWinnerId` counts as an upset call (2 points rather than 1).
 * Seeds are table positions, so the bigger number is the weaker side. Equal or unknown
 * seeds mean there is no favourite to favour — treated as upset-worthy by design.
 */
export function isUpsetCall(slot: PredictableSlot, predictedWinnerId: string): boolean {
  const { homeSeed, awaySeed } = slot;
  if (homeSeed == null || awaySeed == null || homeSeed === awaySeed) return true;
  const winnerSeed = predictedWinnerId === slot.homeId ? homeSeed : awaySeed;
  const otherSeed = predictedWinnerId === slot.homeId ? awaySeed : homeSeed;
  return winnerSeed > otherSeed;
}

/** Points a single pick earns on a decided slot: 0 unless it named the actual winner. */
export function predictionPoints(slot: DecidedSlot, pick: PredictionPick): number {
  if (!slot.winnerId || pick.predictedWinnerId !== slot.winnerId) return 0;
  return isUpsetCall(slot, pick.predictedWinnerId) ? UPSET_POINTS : FAVOURITE_POINTS;
}

/**
 * Whether this pick may count toward the scoreboard. The rules freeze each slot's pick
 * once the tie decides (writes require an open slot), so every stored pick qualifies by
 * construction. Kept as an explicit predicate because walkovers are the one shape the
 * freeze cannot vouch for end-to-end: awardWalkover closes the slot through the same
 * bracket write, but if a pick ever appears stamped AFTER the walkover's admin action it
 * would only be there via a rules bypass — fail safe by dropping it.
 */
export function pickSurvivesCutoff(
  pickWrittenAtMillis: number | null,
  slotDecidedAtMillis: number | null,
): boolean {
  if (pickWrittenAtMillis == null || slotDecidedAtMillis == null) return true;
  return pickWrittenAtMillis <= slotDecidedAtMillis;
}

/** A member's picks doc, flattened for scoring. `picks` maps slotKey → pick (raw, unvalidated). */
export interface PickDocInput {
  predictorId: string;
  picks: Record<string, Partial<PredictionPick> | undefined>;
  /** Millis of the whole-doc write stamp, or null when unageable (legacy docs). Null PASSES:
   *  the rules already guarantee open-slot-only writes, so absence of a readable stamp can't
   *  make a pick late. */
  updatedAtMillis: number | null;
}

export interface ScoreboardEntry {
  predictorId: string;
  points: number;
  correct: number;
  wrong: number;
}

/**
 * Rebuild the season scoreboard from scratch: every member's picks measured against
 * every decided slot. Members whose picks never touch a decided slot produce no entry
 * at all. Sorted points descending; ties break on more correct picks, then predictor id
 * for determinism.
 */
export function buildScoreboard(
  decidedSlots: DecidedSlot[],
  pickDocs: PickDocInput[],
): ScoreboardEntry[] {
  const entries = new Map<string, ScoreboardEntry>();
  const entryFor = (predictorId: string): ScoreboardEntry => {
    let entry = entries.get(predictorId);
    if (!entry) {
      entry = { predictorId, points: 0, correct: 0, wrong: 0 };
      entries.set(predictorId, entry);
    }
    return entry;
  };

  for (const doc of pickDocs) {
    for (const slot of decidedSlots) {
      const pick = doc.picks[slot.key];
      if (!pick || typeof pick.predictedWinnerId !== "string") continue;
      // Created lazily so members whose picks never touch a decided slot (nothing picked
      // yet, or every pick malformed) produce no scoreboard entry at all.
      const entry = entryFor(doc.predictorId);
      const points = predictionPoints(slot, { predictedWinnerId: pick.predictedWinnerId });
      entry.points += points;
      if (points > 0) entry.correct += 1;
      else entry.wrong += 1;
    }
  }

  return [...entries.values()].sort(
    (a, b) =>
      b.points - a.points || b.correct - a.correct || a.predictorId.localeCompare(b.predictorId),
  );
}
