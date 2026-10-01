/**
 * Client port of functions/src/extract/core/statsCheck.mjs, so the photo-logging review can
 * re-check the score live as the player edits values (the server's verdict only covers the
 * AI's original read). statsCheck.test.ts holds the two in parity.
 *
 * A side's goals ≈ its shots on target − the other keeper's saves. When they disagree the
 * score was most likely misread — and goals are the input ELO leans on most.
 */

/** Matches the server: an own goal or a goal-line block can each leave the count off by one. */
export const SCORE_CHECK_TOLERANCE = 1;

export interface ScoreSideInput {
  goals: number | null;
  shotsOnTarget: number | null;
  saves: number | null;
}

export interface ScoreSideCheck {
  goals: number;
  /** Goals the other stats point to: shots on target − the opposing keeper's saves. */
  implied: number;
  ok: boolean;
}

export interface ScoreCheck {
  status: "ok" | "mismatch" | "unknown";
  mine: ScoreSideCheck | null;
  theirs: ScoreSideCheck | null;
}

/** Shots on target from shots × a whole-percent Shot Accuracy (exact below 100 shots). */
export function deriveShotsOnTarget(
  shots: number | null,
  shotAccuracy: number | null,
): number | null {
  if (shots == null || shotAccuracy == null) return null;
  return Math.min(Math.round((shots * shotAccuracy) / 100), shots);
}

function sideCheck(mine: ScoreSideInput, theirs: ScoreSideInput): ScoreSideCheck | null {
  if (mine.goals == null || mine.shotsOnTarget == null || theirs.saves == null) return null;
  const implied = Math.max(0, mine.shotsOnTarget - theirs.saves);
  return {
    goals: mine.goals,
    implied,
    ok: Math.abs(mine.goals - implied) <= SCORE_CHECK_TOLERANCE,
  };
}

/** Same verdict as the server's checkScoreConsistency, framed as my side / their side. */
export function checkScore(mine: ScoreSideInput, theirs: ScoreSideInput): ScoreCheck {
  const m = sideCheck(mine, theirs);
  const t = sideCheck(theirs, mine);
  const checked = [m, t].filter((c): c is ScoreSideCheck => c !== null);
  const status = checked.length === 0 ? "unknown" : checked.every((c) => c.ok) ? "ok" : "mismatch";
  return { status, mine: m, theirs: t };
}
