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

function expectedScore(a: number, b: number): number {
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
    const aScore = match.aGoals > match.bGoals ? 1 : match.aGoals < match.bGoals ? 0 : 0.5;
    const bScore = 1 - aScore;
    const aDelta = Math.round(ELO_K * (aScore - expectedScore(aEloBefore, bEloBefore)));
    const bDelta = Math.round(ELO_K * (bScore - expectedScore(bEloBefore, aEloBefore)));
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
