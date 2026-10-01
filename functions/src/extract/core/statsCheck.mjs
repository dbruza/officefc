// ESM (.mjs) on purpose: imported directly by the root `node --test` suite and compiled by functions tsc. Do not rename to .js.
/* OfficeFC — cross-checks between the numbers on a full-time stats screen.
   EA SPORTS FC 24+ Summary tabs print Shots and a side-panel Shot Accuracy %, but no Shots on
   Target row, plus each keeper's Saves. That gives a second, independent route to the score:
   a side's goals ≈ its shots on target − the other keeper's saves. When the two disagree, the
   score was most likely misread — and goals are the input ELO leans on most.
   Mirrored for the app's live review in mobile/src/lib/league/statsCheck.ts (parity-tested). */

/**
 * Largest |goals − implied goals| still treated as consistent. An own goal adds a goal with no
 * shot on target behind it, and a goal-line block leaves a shot on target with no save.
 */
export const SCORE_CHECK_TOLERANCE = 1;

/**
 * Shots on target for one side: the printed count when the screen has one, otherwise
 * shots × shot accuracy. Accuracy is printed as a whole percent, and adjacent counts sit
 * 100/shots percent apart, so the rounding recovers the exact count for any match with
 * fewer than 100 shots.
 * @returns {{ value: number | null, source: "printed" | "derived" | null }}
 */
export function deriveShotsOnTarget({ shots, shots_on_target, shot_accuracy }) {
  if (shots_on_target != null) return { value: shots_on_target, source: "printed" };
  if (shots == null || shot_accuracy == null) return { value: null, source: null };
  const value = Math.round((shots * shot_accuracy) / 100);
  return { value: Math.min(value, shots), source: "derived" };
}

/** One side's check, or null when a needed value is missing. */
function sideCheck(mine, theirs) {
  if (mine?.goals == null || mine?.shots_on_target == null || theirs?.saves == null) return null;
  const implied = Math.max(0, mine.shots_on_target - theirs.saves);
  return {
    goals: mine.goals,
    implied,
    ok: Math.abs(mine.goals - implied) <= SCORE_CHECK_TOLERANCE,
  };
}

/**
 * Does the read score agree with shots on target and saves? Each side needs its own goals and
 * shots on target plus the OTHER side's saves.
 * - "ok": every checkable side agrees (at least one was checkable)
 * - "mismatch": a checkable side disagrees — ask the player to check the score
 * - "unknown": nothing was checkable (older screens, unreadable values)
 * @returns {{ status: "ok" | "mismatch" | "unknown",
 *             home: { goals: number, implied: number, ok: boolean } | null,
 *             away: { goals: number, implied: number, ok: boolean } | null }}
 */
export function checkScoreConsistency(home, away) {
  const h = sideCheck(home, away);
  const a = sideCheck(away, home);
  const checked = [h, a].filter(Boolean);
  const status = checked.length === 0 ? "unknown" : checked.every((c) => c.ok) ? "ok" : "mismatch";
  return { status, home: h, away: a };
}
