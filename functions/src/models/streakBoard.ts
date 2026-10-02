import type { SeasonStatMatch } from "./seasonStats";
import { currentWinStreak, currentWinlessRun } from "./streaks";
export interface StreakRow {
  playerId: string;
  /** Current consecutive wins — ≥2 to appear. */
  winStreak: number;
  /** Games since their last win — ≥2 to appear (their latest result wasn't a win). */
  winlessRun: number;
}

/** Current-form rows over every confirmed non-finals match in the season: live win
 *  streaks first (longest hottest), then the longest winless miseries. Best-ever runs
 *  are deliberately not shown here — on a form board a past peak reads as current and
 *  says nothing about present heat. */
export function streakRows(matches: SeasonStatMatch[]): StreakRow[] {
  const uids = new Set<string>();
  for (const match of matches) {
    if (match.finals) continue;
    uids.add(match.aId);
    uids.add(match.bId);
  }
  const hot: StreakRow[] = [];
  const cold: StreakRow[] = [];
  for (const playerId of uids) {
    const winStreak = currentWinStreak(playerId, matches);
    if (winStreak >= 2) {
      hot.push({ playerId, winStreak, winlessRun: 0 });
      continue;
    }
    const winlessRun = currentWinlessRun(playerId, matches);
    if (winlessRun >= 2) cold.push({ playerId, winStreak: 0, winlessRun });
  }
  // Longest run first; ties break by uid for a stable board.
  const byLengthDesc = (a: StreakRow, b: StreakRow) =>
    b.winStreak - a.winStreak ||
    b.winlessRun - a.winlessRun ||
    a.playerId.localeCompare(b.playerId);
  return [...hot.sort(byLengthDesc), ...cold.sort(byLengthDesc)];
}
