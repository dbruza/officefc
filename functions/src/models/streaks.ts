/**
 * Active-streak stats: win streaks and winless runs, per player, from confirmed match
 * lists. Pure module — no Firestore access — so screens can feed it whatever match
 * shape they already hold (LeagueMatch, CalculatedMatch, or a hand-built row).
 *
 * Ordering convention (pinned by tests in streaks.test.ts, do not change silently):
 * form arrays and computed result runs are OLDEST FIRST, MOST RECENT LAST — the same
 * direction elo.ts builds Standing.form and FormChips fades its chips. When every
 * match carries a usable date the helpers sort into that order themselves; if any
 * date is missing the input array order is trusted as-is rather than half-sorted.
 */
import type { MatchResult } from "./types";

/** Minimal match shape needed for streak math; superset-compatible with real match docs. */
export interface StreakMatch {
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  /** Kickoff as millis or Date. Absent/null/invalid dates leave input order untouched. */
  date?: number | Date | null;
  /** Finals matches never count toward season stats, so they are excluded by default. */
  finals?: boolean;
}

export interface StreakOptions {
  /** Include finals matches. Default false — the bracket is excluded from stats everywhere else. */
  includeFinals?: boolean;
}

/** The trailing run of identical results at the newest end of a form array. */
export interface ActiveStreak {
  /** Result code matching MatchResult, so UIs can reuse resultColor/chip styling. */
  type: MatchResult;
  /** How many consecutive identical results end the form, minimum 1. */
  length: number;
}

function timeOf(match: StreakMatch): number | null {
  if (match.date instanceof Date) {
    const t = match.date.getTime();
    return Number.isNaN(t) ? null : t;
  }
  return typeof match.date === "number" ? match.date : null;
}

/**
 * Oldest → newest. Only sorts when every match has a usable date: mixing dated and
 * undated entries would make "where did the undated ones sit?" arbitrary, so such
 * lists are consumed in the order given and the caller owns their sequence.
 */
function orderedMatches(matches: StreakMatch[]): StreakMatch[] {
  const list = [...matches];
  if (!list.every((m) => timeOf(m) !== null)) return list;
  return list.sort((x, y) => (timeOf(x) as number) - (timeOf(y) as number));
}

/**
 * One player's results, oldest → newest, ready for FormChips or the streak helpers
 * below. Matches not involving the player are ignored; draws and losses stay distinct.
 */
export function playerResults(
  uid: string,
  matches: readonly StreakMatch[],
  options: StreakOptions = {},
): MatchResult[] {
  const includeFinals = options.includeFinals === true;
  const played = matches.filter(
    (m) => (includeFinals || !m.finals) && (m.aId === uid || m.bId === uid),
  );
  return orderedMatches(played).map((m) => {
    const gf = m.aId === uid ? m.aGoals : m.bGoals;
    const ga = m.aId === uid ? m.bGoals : m.aGoals;
    return gf > ga ? "W" : gf < ga ? "L" : "D";
  });
}

/** Current run of consecutive wins ending at the player's most recent game; 0 if it wasn't a win. */
export function currentWinStreak(
  uid: string,
  matches: readonly StreakMatch[],
  options: StreakOptions = {},
): number {
  const results = playerResults(uid, matches, options);
  let streak = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === "W"; i -= 1) streak += 1;
  return streak;
}

/** Best consecutive-win run anywhere in the supplied window, not just the present one. */
export function longestWinStreak(
  uid: string,
  matches: readonly StreakMatch[],
  options: StreakOptions = {},
): number {
  let best = 0;
  let run = 0;
  for (const r of playerResults(uid, matches, options)) {
    run = r === "W" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Games since the player's last win, counting the latest game first: draws AND losses
 * both extend it. 0 means their most recent game was a win.
 */
export function currentWinlessRun(
  uid: string,
  matches: readonly StreakMatch[],
  options: StreakOptions = {},
): number {
  const results = playerResults(uid, matches, options);
  let run = 0;
  for (let i = results.length - 1; i >= 0 && results[i] !== "W"; i -= 1) run += 1;
  return run;
}

/** Worst winless run in the window. A player who never won is winless for every game played. */
export function longestWinlessRun(
  uid: string,
  matches: readonly StreakMatch[],
  options: StreakOptions = {},
): number {
  let best = 0;
  let run = 0;
  for (const r of playerResults(uid, matches, options)) {
    run = r !== "W" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The streak a form array currently ends on, e.g. ["W","W","D","L","L"] → { type: "L",
 * length: 2 }. Expects oldest → newest (Standing.form order); an empty form has no streak.
 */
export function activeStreak(form: readonly MatchResult[]): ActiveStreak | null {
  if (form.length === 0) return null;
  const type = form[form.length - 1];
  let length = 0;
  for (let i = form.length - 1; i >= 0 && form[i] === type; i -= 1) length += 1;
  return { type, length };
}
