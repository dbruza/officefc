export const BASE_ELO = 1500;
export const ELO_K = 32;
/** Elo points each FIFA team-overall point is worth when handicapping the expected score. */
export const TEAM_ELO_PER_OVERALL = 12;
/** Elo points added to the reigning Premier's effective rating for the expected-score
 *  calculation. Like the team handicap it never accumulates into the stored rating — it
 *  makes wins worth less and losses cost more for the previous season's table-topper. */
export const PREMIER_HANDICAP_ELO = 100;

/** Games a player must complete before they hold a ranked place in the standings. */
export const MIN_RANKED_GAMES = 3;
/** Higher K applied while a player's seasonal rating is still finding its level. */
export const PROVISIONAL_K = 40;
/** Number of a player's first games each season that use the provisional K. */
export const PROVISIONAL_GAMES = 10;

/**
 * K-factor for a delta, given how many games the player had already completed this season
 * before this match. New players use a higher K so their rating finds its level faster, then
 * settle to the standard K once they have played PROVISIONAL_GAMES.
 */
export function getK(gamesPlayedBefore: number): number {
  return gamesPlayedBefore < PROVISIONAL_GAMES ? PROVISIONAL_K : ELO_K;
}

export type MatchResult = "W" | "D" | "L";

export interface SeasonMatchInput {
  id: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  dateMillis: number;
  aXg?: number | null;
  bXg?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
  aTeamOverall?: number | null;
  bTeamOverall?: number | null;
}

/** Per-match breakdown of how each side's Elo delta was produced, for the "why did my
 *  rating change?" UI. `teamAdj` is the net team-strength handicap (in Elo points) applied
 *  to that side's effective rating: positive means the stronger team, negative the weaker.
 *  `premierAdj` is the net reigning-Premier handicap in the same convention: +PREMIER_HANDICAP_ELO
 *  on the title holder's side, the mirror image on their opponent's, 0/0 when neither holds it. */
export interface EloExplain {
  aExpected: number;
  bExpected: number;
  perfA: number;
  perfB: number;
  aTeamAdj: number;
  bTeamAdj: number;
  aPremierAdj: number;
  bPremierAdj: number;
  aK: number;
  bK: number;
}

export interface CalculatedMatch extends SeasonMatchInput {
  aEloBefore: number;
  aEloAfter: number;
  aDelta: number;
  bEloBefore: number;
  bEloAfter: number;
  bDelta: number;
  eloExplain?: EloExplain;
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
  ranked: boolean;
}

/**
 * Standings order for players who have qualified: Elo, then goal difference, then wins, then
 * fewer games played (rewards a tighter record), then uid as a stable final tie-break.
 */
export function compareStandings(a: Standing, b: Standing): number {
  return (
    b.elo - a.elo ||
    b.gf - b.ga - (a.gf - a.ga) ||
    b.w - a.w ||
    a.w + a.d + a.l - (b.w + b.d + b.l) ||
    a.uid.localeCompare(b.uid)
  );
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
export const W_XG = 0.25;
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
  aXg?: number | null;
  bXg?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
}): number {
  const parts: Array<[number, number]> = [[W_GOALS, goalScore(m.aGoals, m.bGoals)]];
  const xg = share(m.aXg, m.bXg);
  if (xg != null) parts.push([W_XG, xg]);
  const poss = share(m.aPossession, m.bPossession);
  if (poss != null) parts.push([W_POSS, poss]);
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  return parts.reduce((s, [w, v]) => s + w * v, 0) / wsum;
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Ratings used for the expected-score calculation, handicapped by team strength: each side's
 * player Elo is shifted by TEAM_ELO_PER_OVERALL per team-overall point. When either team's
 * overall is missing, no handicap applies and the raw player ratings are returned. The handicap
 * never accumulates into a player's stored rating — it only tilts how much a result is worth.
 */
export function effectiveRatings(
  aElo: number,
  bElo: number,
  aOverall: number | null | undefined,
  bOverall: number | null | undefined,
): [number, number] {
  if (aOverall == null || bOverall == null) return [aElo, bElo];
  return [aElo + TEAM_ELO_PER_OVERALL * aOverall, bElo + TEAM_ELO_PER_OVERALL * bOverall];
}

function resultFor(goalsFor: number, goalsAgainst: number): MatchResult {
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

export interface SeasonCalcOptions {
  /** Reigning Premier (previous season's table-topper; falls back to its champion for
   *  table-format seasons). Their effective rating is raised by PREMIER_HANDICAP_ELO for
   *  the expected-score calculation in every match they play. */
  premierId?: string | null;
}

/**
 * Rebuild a season from confirmed matches only. Sorting by timestamp then document id
 * makes repeated recalculations deterministic, including matches logged in the same millisecond.
 */
export function calculateSeason(
  inputMatches: SeasonMatchInput[],
  memberIds: string[],
  seasonStartMillis: number,
  options?: SeasonCalcOptions,
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
    const aStats = stats.get(match.aId)!;
    const bStats = stats.get(match.bId)!;
    // Games each player had completed this season before this match drives the K-factor.
    const aK = getK(aStats.w + aStats.d + aStats.l);
    const bK = getK(bStats.w + bStats.d + bStats.l);
    const perfA = performanceScore(match);
    const [aEff, bEff] = effectiveRatings(
      aEloBefore,
      bEloBefore,
      match.aTeamOverall,
      match.bTeamOverall,
    );
    const premierA = options?.premierId === match.aId ? PREMIER_HANDICAP_ELO : 0;
    const premierB = options?.premierId === match.bId ? PREMIER_HANDICAP_ELO : 0;
    const aExpected = expectedScore(aEff + premierA, bEff + premierB);
    const bExpected = expectedScore(bEff + premierB, aEff + premierA);
    const aDelta = Math.round(aK * (perfA - aExpected));
    const bDelta = Math.round(bK * (1 - perfA - bExpected));
    const aEloAfter = aEloBefore + aDelta;
    const bEloAfter = bEloBefore + bDelta;
    // Net team-strength handicap on each side (Elo points), positive for the stronger team.
    const aHandicap = aEff - aEloBefore;
    const bHandicap = bEff - bEloBefore;
    const aTeamAdj = aHandicap - bHandicap;
    const bTeamAdj = bHandicap - aHandicap;

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
      eloExplain: {
        aExpected,
        bExpected,
        perfA,
        perfB: 1 - perfA,
        aTeamAdj,
        bTeamAdj,
        aPremierAdj: premierA - premierB,
        bPremierAdj: premierB - premierA,
        aK,
        bK,
      },
    };
  });

  const standings = [...players]
    .map((uid): Standing => {
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
        ranked: row.w + row.d + row.l >= MIN_RANKED_GAMES,
      };
    })
    .filter((row) => row.w + row.d + row.l > 0)
    // Ranked players first, then provisional; each group ordered by the tie-break chain.
    .sort((a, b) => Number(b.ranked) - Number(a.ranked) || compareStandings(a, b));

  // Only ranked players occupy a numbered place; provisional players keep rank 0.
  let rankCounter = 0;
  for (const row of standings) {
    if (row.ranked) row.rank = ++rankCounter;
  }

  return { matches: calculated, standings, history };
}

const POTM_MIN_GAMES = 3;

function getMonthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type MonthlyGains = Map<string, { totalGain: number; games: number; endingElo: number }>;

/** Player of the month per calendar month: the largest total ELO gain among players with at
 *  least POTM_MIN_GAMES games that month. Ties break by ending ELO, then lexical uid.
 *  Replays the season through calculateSeason and accumulates its per-match deltas, so POTM
 *  can never drift from the rating walk that produces the actual standings. */
export function computePOTM(
  matches: SeasonMatchInput[],
  options?: SeasonCalcOptions,
): Array<{ month: string; playerId: string; gain: number; games: number }> {
  const { matches: calculated } = calculateSeason(matches, [], 0, options);
  const months = new Map<string, MonthlyGains>();
  const result: Array<{ month: string; playerId: string; gain: number; games: number }> = [];

  for (const match of calculated) {
    const month = getMonthKey(match.dateMillis);
    if (!months.has(month)) months.set(month, new Map());
    const gains = months.get(month)!;
    for (const [id, delta, rating] of [
      [match.aId, match.aDelta, match.aEloAfter],
      [match.bId, match.bDelta, match.bEloAfter],
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
