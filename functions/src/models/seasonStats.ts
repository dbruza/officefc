/**
 * Season stats leaderboards, aggregated entirely client-side from confirmed
 * match documents (the AI-extracted possession / shots / xG columns).
 *
 * Pure module: no Firebase imports. Callers hand over match-shaped records and
 * every function is deterministic, so unit tests run without Firestore.
 */

/**
 * The slice of a confirmed match document that season stats need. Stat fields
 * are the flat AI-extraction columns (`aXg`, `bPossession`, …); `null` means
 * "not captured for that side". Only CONFIRMED matches should be passed in.
 */
export interface SeasonStatMatch {
  id: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  /** True on bracket ties — dropped by every board (see regularMatches). */
  finals?: boolean;
  /** Kickoff time. The aggregate boards ignore it, but the streaks board needs real
   *  sequence — without dates the streak helpers must trust array order, which is
   *  document-id order and unrelated to when games were played. */
  date?: Date | null;
  aPossession: number | null;
  bPossession: number | null;
  aShots: number | null;
  bShots: number | null;
  aShotsOnTarget: number | null;
  bShotsOnTarget: number | null;
  aXg: number | null;
  bXg: number | null;
}

// --- Clinical finishers (goals vs xG) ---------------------------------------

/**
 * One player's goals-vs-xG finishing line. The row counts ONLY matches where
 * the player's own side carried an xG value, so the delta compares like with
 * like; `totalGames` keeps the fuller picture for context.
 */
export interface ClinicalFinishingRow {
  playerId: string;
  /** xG-carrying matches — the row's counting base. */
  games: number;
  /** Goals scored in those matches. */
  goals: number;
  /** Summed xG across those matches (2 dp). */
  xg: number;
  /** goals − xg; positive = finishing above the chance quality (2 dp). */
  delta: number;
  /** All confirmed non-finals matches played, for context. */
  totalGames: number;
}

/**
 * Players ranked by xG overperformance (goals minus xG across the matches that
 * carry xG for their side). A missing xG on one side never blocks the OTHER
 * side's row, and an xG of exactly 0 is real data, not absence.
 */
export function clinicalFinishers(matches: SeasonStatMatch[]): ClinicalFinishingRow[] {
  interface Acc {
    games: number;
    goals: number;
    xgGames: number;
    xgGoals: number;
    xg: number;
  }
  const acc = new Map<string, Acc>();
  const side = (uid: string): Acc => {
    let entry = acc.get(uid);
    if (!entry) {
      entry = { games: 0, goals: 0, xgGames: 0, xgGoals: 0, xg: 0 };
      acc.set(uid, entry);
    }
    return entry;
  };

  for (const match of regularMatches(matches)) {
    const a = side(match.aId);
    const b = side(match.bId);
    a.games += 1;
    a.goals += match.aGoals;
    b.games += 1;
    b.goals += match.bGoals;
    if (match.aXg != null) {
      a.xgGames += 1;
      a.xgGoals += match.aGoals;
      a.xg += match.aXg;
    }
    if (match.bXg != null) {
      b.xgGames += 1;
      b.xgGoals += match.bGoals;
      b.xg += match.bXg;
    }
  }

  return [...acc.entries()]
    .filter(([, entry]) => entry.xgGames > 0)
    .map(([playerId, entry]) => ({
      playerId,
      games: entry.xgGames,
      goals: entry.xgGoals,
      xg: round2(entry.xg),
      delta: round2(entry.xgGoals - entry.xg),
      totalGames: entry.games,
    }))
    .sort((x, y) => y.delta - x.delta || y.goals - x.goals || x.playerId.localeCompare(y.playerId));
}

/**
 * Players who played at least one counted match but never carried an xG value —
 * surfaced as a coverage note rather than silently omitted.
 */
export function playersWithoutXgData(matches: SeasonStatMatch[]): string[] {
  const played = new Set<string>();
  const covered = new Set<string>();
  for (const match of regularMatches(matches)) {
    played.add(match.aId);
    played.add(match.bId);
    if (match.aXg != null) covered.add(match.aId);
    if (match.bXg != null) covered.add(match.bId);
  }
  return [...played].filter((uid) => !covered.has(uid)).sort((x, y) => x.localeCompare(y));
}

// --- Shot volume -------------------------------------------------------------

export interface ShotVolumeRow {
  playerId: string;
  /** Confirmed non-finals matches played, for context. */
  games: number;
  shots: number;
  shotsOnTarget: number;
  /** shotsOnTarget / shots × 100 (1 dp); null when no shots were recorded. */
  accuracyPct: number | null;
}

/** How many shooters the shot-volume board shows. */
export const SHOT_VOLUME_LIMIT = 5;

/** Top shooters by total shots, with shooting accuracy alongside. */
export function shotVolumeLeaders(
  matches: SeasonStatMatch[],
  limit = SHOT_VOLUME_LIMIT,
): ShotVolumeRow[] {
  interface Acc {
    games: number;
    shots: number;
    onTarget: number;
  }
  const acc = new Map<string, Acc>();
  const side = (uid: string): Acc => {
    let entry = acc.get(uid);
    if (!entry) {
      entry = { games: 0, shots: 0, onTarget: 0 };
      acc.set(uid, entry);
    }
    return entry;
  };

  for (const match of regularMatches(matches)) {
    const a = side(match.aId);
    const b = side(match.bId);
    a.games += 1;
    b.games += 1;
    if (match.aShots != null) a.shots += match.aShots;
    if (match.bShots != null) b.shots += match.bShots;
    if (match.aShotsOnTarget != null) a.onTarget += match.aShotsOnTarget;
    if (match.bShotsOnTarget != null) b.onTarget += match.bShotsOnTarget;
  }

  return [...acc.entries()]
    .filter(([, entry]) => entry.shots > 0)
    .map(([playerId, entry]) => ({
      playerId,
      games: entry.games,
      shots: entry.shots,
      shotsOnTarget: entry.onTarget,
      accuracyPct: round1((entry.onTarget / entry.shots) * 100),
    }))
    .sort(
      (x, y) =>
        y.shots - x.shots ||
        y.shotsOnTarget - x.shotsOnTarget ||
        x.playerId.localeCompare(y.playerId),
    )
    .slice(0, limit);
}

// --- Possession --------------------------------------------------------------

export interface PossessionRow {
  playerId: string;
  /** Matches carrying a possession value — the average's denominator. */
  games: number;
  /** Mean possession % (1 dp). */
  averagePct: number;
}

/** Players ranked by average possession across the matches that report it. */
export function possessionLeaders(matches: SeasonStatMatch[]): PossessionRow[] {
  const acc = new Map<string, { games: number; sum: number }>();
  const side = (uid: string) => {
    let entry = acc.get(uid);
    if (!entry) {
      entry = { games: 0, sum: 0 };
      acc.set(uid, entry);
    }
    return entry;
  };

  for (const match of regularMatches(matches)) {
    if (match.aPossession != null) {
      const a = side(match.aId);
      a.games += 1;
      a.sum += match.aPossession;
    }
    if (match.bPossession != null) {
      const b = side(match.bId);
      b.games += 1;
      b.sum += match.bPossession;
    }
  }

  return [...acc.entries()]
    .map(([playerId, entry]) => ({
      playerId,
      games: entry.games,
      averagePct: round1(entry.sum / entry.games),
    }))
    .sort(
      (x, y) =>
        y.averagePct - x.averagePct || y.games - x.games || x.playerId.localeCompare(y.playerId),
    );
}

// --- Combined board ----------------------------------------------------------

export interface SeasonLeaderboardStats {
  clinical: ClinicalFinishingRow[];
  /** Played but never carried xG — shown as a coverage note, not a ranking. */
  playersWithoutXg: string[];
  shotVolume: ShotVolumeRow[];
  possession: PossessionRow[];
}

/** Every stats board for one season, in one pass-friendly entrypoint. */
export function aggregateSeasonStats(matches: SeasonStatMatch[]): SeasonLeaderboardStats {
  return {
    clinical: clinicalFinishers(matches),
    playersWithoutXg: playersWithoutXgData(matches),
    shotVolume: shotVolumeLeaders(matches),
    possession: possessionLeaders(matches),
  };
}

// --- Internals ----------------------------------------------------------------

/**
 * Finals matches decide the bracket only — they never feed stats, exactly as
 * they never feed ELO or the table. Mirrors the server's post-query filter
 * `docs.filter((doc) => doc.get("finals") !== true)` (functions/src/recalc.ts,
 * functions/src/seasonAdmin.ts): a `where("finals", "!=", true)` query would
 * ALSO drop every ordinary match that simply lacks the field, so this has to
 * stay a client-side exclusion.
 */
function regularMatches(matches: SeasonStatMatch[]): SeasonStatMatch[] {
  return matches.filter((match) => match.finals !== true);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
