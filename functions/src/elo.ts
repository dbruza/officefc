export const BASE_ELO = 1500;
export const ELO_K = 32;

export type MatchResult = "W" | "D" | "L";

export interface SeasonMatchInput {
  id: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  dateMillis: number;
  aShotsOnTarget?: number | null;
  bShotsOnTarget?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
}

export interface CalculatedMatch extends SeasonMatchInput {
  aEloBefore: number;
  aEloAfter: number;
  aDelta: number;
  bEloBefore: number;
  bEloAfter: number;
  bDelta: number;
}

export interface Standing {
  uid: string;
  rank: number;
  elo: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  form: MatchResult[];
  move: number;
}

export interface HistoryPoint {
  matchId: string | null;
  dateMillis: number;
  rating: number;
}

export interface SeasonCalculation {
  matches: CalculatedMatch[];
  standings: Standing[];
  history: Record<string, HistoryPoint[]>;
}

export const W_GOALS = 0.6;
export const W_SOT = 0.25;
export const W_POSS = 0.15;
const GOAL_MARGIN_SCALE = 2;

function goalScore(gf: number, ga: number): number {
  const gd = gf - ga;
  return 0.5 + 0.5 * (gd / (Math.abs(gd) + GOAL_MARGIN_SCALE));
}

function share(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  const t = a + b;
  return t > 0 ? a / t : null;
}

export function performanceScore(m: {
  aGoals: number;
  bGoals: number;
  aShotsOnTarget?: number | null;
  bShotsOnTarget?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
}): number {
  const parts: Array<[number, number]> = [[W_GOALS, goalScore(m.aGoals, m.bGoals)]];
  const sot = share(m.aShotsOnTarget, m.bShotsOnTarget);
  if (sot != null) parts.push([W_SOT, sot]);
  const poss = share(m.aPossession, m.bPossession);
  if (poss != null) parts.push([W_POSS, poss]);
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  return parts.reduce((s, [w, v]) => s + w * v, 0) / wsum;
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function resultFor(goalsFor: number, goalsAgainst: number): MatchResult {
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

/**
 * Rebuild a season from confirmed matches only. Sorting by timestamp then document id
 * makes repeated recalculations deterministic, including matches logged in the same millisecond.
 */
export function calculateSeason(
  inputMatches: SeasonMatchInput[],
  memberIds: string[],
  seasonStartMillis: number,
): SeasonCalculation {
  const matches = [...inputMatches].sort(
    (a, b) => a.dateMillis - b.dateMillis || a.id.localeCompare(b.id),
  );
  const players = new Set(memberIds);
  for (const match of matches) {
    players.add(match.aId);
    players.add(match.bId);
  }

  const ratings = new Map<string, number>();
  const stats = new Map<
    string,
    { w: number; d: number; l: number; gf: number; ga: number; form: MatchResult[] }
  >();
  const history: Record<string, HistoryPoint[]> = {};

  for (const uid of players) {
    ratings.set(uid, BASE_ELO);
    stats.set(uid, { w: 0, d: 0, l: 0, gf: 0, ga: 0, form: [] });
    history[uid] = [{ matchId: null, dateMillis: seasonStartMillis, rating: BASE_ELO }];
  }

  const calculated = matches.map((match): CalculatedMatch => {
    const aEloBefore = ratings.get(match.aId) ?? BASE_ELO;
    const bEloBefore = ratings.get(match.bId) ?? BASE_ELO;
    const perfA = performanceScore(match);
    const aDelta = Math.round(ELO_K * (perfA - expectedScore(aEloBefore, bEloBefore)));
    const bDelta = Math.round(ELO_K * (1 - perfA - expectedScore(bEloBefore, aEloBefore)));
    const aEloAfter = aEloBefore + aDelta;
    const bEloAfter = bEloBefore + bDelta;

    ratings.set(match.aId, aEloAfter);
    ratings.set(match.bId, bEloAfter);
    history[match.aId].push({
      matchId: match.id,
      dateMillis: match.dateMillis,
      rating: aEloAfter,
    });
    history[match.bId].push({
      matchId: match.id,
      dateMillis: match.dateMillis,
      rating: bEloAfter,
    });

    const aStats = stats.get(match.aId)!;
    const bStats = stats.get(match.bId)!;
    const aResult = resultFor(match.aGoals, match.bGoals);
    const bResult = resultFor(match.bGoals, match.aGoals);
    aStats.gf += match.aGoals;
    aStats.ga += match.bGoals;
    bStats.gf += match.bGoals;
    bStats.ga += match.aGoals;
    aStats[aResult === "W" ? "w" : aResult === "D" ? "d" : "l"] += 1;
    bStats[bResult === "W" ? "w" : bResult === "D" ? "d" : "l"] += 1;
    aStats.form.push(aResult);
    bStats.form.push(bResult);

    return {
      ...match,
      aEloBefore,
      aEloAfter,
      aDelta,
      bEloBefore,
      bEloAfter,
      bDelta,
    };
  });

  const standings = [...players]
    .map((uid) => {
      const row = stats.get(uid)!;
      return {
        uid,
        rank: 0,
        elo: ratings.get(uid) ?? BASE_ELO,
        w: row.w,
        d: row.d,
        l: row.l,
        gf: row.gf,
        ga: row.ga,
        form: row.form.slice(-5),
        move: 0,
      };
    })
    .filter((row) => row.w + row.d + row.l > 0)
    .sort((a, b) => b.elo - a.elo || b.w - a.w || a.uid.localeCompare(b.uid));

  standings.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { matches: calculated, standings, history };
}

const POTM_MIN_GAMES = 3;

function getMonthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type MonthlyGains = Map<string, { totalGain: number; games: number; endingElo: number }>;

/** Player of the month per calendar month: the largest total ELO gain among players with at
 *  least POTM_MIN_GAMES games that month. Ties break by ending ELO, then lexical uid. */
export function computePOTM(
  matches: SeasonMatchInput[],
): Array<{ month: string; playerId: string; gain: number; games: number }> {
  const sorted = [...matches].sort(
    (a, b) => a.dateMillis - b.dateMillis || a.id.localeCompare(b.id),
  );
  const ratings = new Map<string, number>();
  const months = new Map<string, MonthlyGains>();
  const result: Array<{ month: string; playerId: string; gain: number; games: number }> = [];

  for (const match of sorted) {
    const aBefore = ratings.get(match.aId) ?? BASE_ELO;
    const bBefore = ratings.get(match.bId) ?? BASE_ELO;
    const perfA = performanceScore(match);
    const aDelta = Math.round(ELO_K * (perfA - expectedScore(aBefore, bBefore)));
    const bDelta = Math.round(ELO_K * (1 - perfA - expectedScore(bBefore, aBefore)));
    const aAfter = aBefore + aDelta;
    const bAfter = bBefore + bDelta;
    ratings.set(match.aId, aAfter);
    ratings.set(match.bId, bAfter);

    const month = getMonthKey(match.dateMillis);
    if (!months.has(month)) months.set(month, new Map());
    const gains = months.get(month)!;
    for (const [id, delta, rating] of [
      [match.aId, aDelta, aAfter],
      [match.bId, bDelta, bAfter],
    ] as const) {
      const prev = gains.get(id) ?? { totalGain: 0, games: 0, endingElo: 0 };
      prev.totalGain += delta;
      prev.games += 1;
      prev.endingElo = rating;
      gains.set(id, prev);
    }
  }

  for (const [month, gains] of months) {
    let best: { id: string; gain: number; games: number; endingElo: number } | null = null;
    for (const [uid, info] of gains) {
      if (info.games < POTM_MIN_GAMES) continue;
      if (
        !best ||
        info.totalGain > best.gain ||
        (info.totalGain === best.gain && info.endingElo > best.endingElo) ||
        (info.totalGain === best.gain && info.endingElo === best.endingElo && uid < best.id)
      ) {
        best = { id: uid, gain: info.totalGain, games: info.games, endingElo: info.endingElo };
      }
    }
    if (best) {
      result.push({ month, playerId: best.id, gain: best.gain, games: best.games });
    }
  }
  return result;
}
