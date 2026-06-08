export type Result = "W" | "D" | "L";

export interface ConfirmedMatchInput {
  id: string;
  seasonId: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  aDelta: number;
  bDelta: number;
  dateMillis: number;
}

export interface BiggestWin {
  matchId: string;
  opponentId: string;
  goalsFor: number;
  goalsAgainst: number;
  margin: number;
}

export interface PlayerStats {
  uid: string;
  w: number;
  d: number;
  l: number;
  games: number;
  gf: number;
  ga: number;
  winRate: number;
  currentStreak: number;
  currentStreakType: Result | null;
  longestWin: number;
  longestUnbeaten: number;
  biggestWin: BiggestWin | null;
  nemesis: {
    opponentId: string;
    wins: number;
    draws: number;
    losses: number;
    games: number;
  } | null;
}

export interface Meeting {
  matchId: string;
  seasonId: string;
  dateMillis: number;
  aGoals: number;
  bGoals: number;
  aDelta: number;
  bDelta: number;
}

export interface HeadToHead {
  pairKey: string;
  aId: string;
  bId: string;
  aWins: number;
  bWins: number;
  draws: number;
  aGoals: number;
  bGoals: number;
  meetings: Meeting[];
}

export interface LeagueStats {
  players: PlayerStats[];
  headToHead: HeadToHead[];
}

interface Perspective {
  result: Result;
  opponentId: string;
  goalsFor: number;
  goalsAgainst: number;
}

function resultFor(goalsFor: number, goalsAgainst: number): Result {
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

function perspective(match: ConfirmedMatchInput, uid: string): Perspective {
  const isA = match.aId === uid;
  const goalsFor = isA ? match.aGoals : match.bGoals;
  const goalsAgainst = isA ? match.bGoals : match.aGoals;
  return {
    result: resultFor(goalsFor, goalsAgainst),
    opponentId: isA ? match.bId : match.aId,
    goalsFor,
    goalsAgainst,
  };
}

export function pairKeyFor(aId: string, bId: string): string {
  return [aId, bId].sort().join("__");
}

export function deriveLeagueStats(
  inputMatches: ConfirmedMatchInput[],
  memberIds: string[],
): LeagueStats {
  const matches = [...inputMatches].sort(
    (a, b) => a.dateMillis - b.dateMillis || a.id.localeCompare(b.id),
  );
  const playerIds = new Set(memberIds);
  for (const match of matches) {
    playerIds.add(match.aId);
    playerIds.add(match.bId);
  }

  const pairMap = new Map<string, HeadToHead>();
  for (const match of matches) {
    const pairKey = pairKeyFor(match.aId, match.bId);
    const [aId, bId] = [match.aId, match.bId].sort();
    const row = pairMap.get(pairKey) ?? {
      pairKey,
      aId,
      bId,
      aWins: 0,
      bWins: 0,
      draws: 0,
      aGoals: 0,
      bGoals: 0,
      meetings: [],
    };
    const storedAsPlayed = match.aId === aId;
    const aGoals = storedAsPlayed ? match.aGoals : match.bGoals;
    const bGoals = storedAsPlayed ? match.bGoals : match.aGoals;
    const aDelta = storedAsPlayed ? match.aDelta : match.bDelta;
    const bDelta = storedAsPlayed ? match.bDelta : match.aDelta;

    row.aGoals += aGoals;
    row.bGoals += bGoals;
    if (aGoals > bGoals) row.aWins += 1;
    else if (aGoals < bGoals) row.bWins += 1;
    else row.draws += 1;
    row.meetings.push({
      matchId: match.id,
      seasonId: match.seasonId,
      dateMillis: match.dateMillis,
      aGoals,
      bGoals,
      aDelta,
      bDelta,
    });
    pairMap.set(pairKey, row);
  }

  const players = [...playerIds].map((uid): PlayerStats => {
    const mine = matches.filter((match) => match.aId === uid || match.bId === uid);
    const perspectives = mine.map((match) => ({ match, ...perspective(match, uid) }));
    let w = 0;
    let d = 0;
    let l = 0;
    let gf = 0;
    let ga = 0;
    let longestWin = 0;
    let longestUnbeaten = 0;
    let winRun = 0;
    let unbeatenRun = 0;
    let biggestWin: BiggestWin | null = null;

    for (const item of perspectives) {
      gf += item.goalsFor;
      ga += item.goalsAgainst;
      if (item.result === "W") {
        w += 1;
        winRun += 1;
        unbeatenRun += 1;
        const margin = item.goalsFor - item.goalsAgainst;
        if (!biggestWin || margin > biggestWin.margin) {
          biggestWin = {
            matchId: item.match.id,
            opponentId: item.opponentId,
            goalsFor: item.goalsFor,
            goalsAgainst: item.goalsAgainst,
            margin,
          };
        }
      } else if (item.result === "D") {
        d += 1;
        winRun = 0;
        unbeatenRun += 1;
      } else {
        l += 1;
        winRun = 0;
        unbeatenRun = 0;
      }
      longestWin = Math.max(longestWin, winRun);
      longestUnbeaten = Math.max(longestUnbeaten, unbeatenRun);
    }

    const latestResult = perspectives.at(-1)?.result ?? null;
    let currentStreak = 0;
    for (let index = perspectives.length - 1; index >= 0; index -= 1) {
      if (perspectives[index].result !== latestResult) break;
      currentStreak += 1;
    }

    const candidates = [...pairMap.values()]
      .filter((pair) => pair.aId === uid || pair.bId === uid)
      .map((pair) => {
        const isA = pair.aId === uid;
        const wins = isA ? pair.aWins : pair.bWins;
        const losses = isA ? pair.bWins : pair.aWins;
        const games = pair.aWins + pair.bWins + pair.draws;
        return {
          opponentId: isA ? pair.bId : pair.aId,
          wins,
          draws: pair.draws,
          losses,
          games,
          share: games ? (wins + pair.draws * 0.5) / games : 1,
        };
      })
      .filter((candidate) => candidate.games >= 3)
      .sort(
        (a, b) =>
          a.share - b.share || b.games - a.games || a.opponentId.localeCompare(b.opponentId),
      );
    const nemesis = candidates[0]
      ? {
          opponentId: candidates[0].opponentId,
          wins: candidates[0].wins,
          draws: candidates[0].draws,
          losses: candidates[0].losses,
          games: candidates[0].games,
        }
      : null;

    const games = w + d + l;
    return {
      uid,
      w,
      d,
      l,
      games,
      gf,
      ga,
      winRate: games ? Math.round((w / games) * 100) : 0,
      currentStreak,
      currentStreakType: latestResult,
      longestWin,
      longestUnbeaten,
      biggestWin,
      nemesis,
    };
  });

  const headToHead = [...pairMap.values()].map((pair) => ({
    ...pair,
    meetings: pair.meetings.slice(-20).reverse(),
  }));
  return { players, headToHead };
}
