import type { LeagueMatch } from "./types";
export type AwardKey = "boot" | "glove" | "improved" | "streak" | "draw" | "giant";
export interface SeasonAward {
  key: AwardKey;
  playerId: string;
  stat: string | number;
  statLabel: string;
  /** Giant Killer links to the upset match. */
  matchId?: string;
  opponentId?: string;
}

/** Golden Glove only counts players with a minimum body of work. */
export const GLOVE_MIN_GAMES = 5;

interface SeasonAgg {
  gf: number;
  ga: number;
  games: number;
  draws: number;
  eloGain: number;
  longestWin: number;
  run: number;
}

function sortByDate(matches: LeagueMatch[]): LeagueMatch[] {
  return matches.slice().sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

/**
 * The six season awards, computed live from a season's confirmed matches.
 * Returns [] until at least one match is in.
 */
export function computeSeasonAwards(matches: LeagueMatch[]): SeasonAward[] {
  const played = sortByDate(matches);
  if (played.length === 0) return [];

  const agg = new Map<string, SeasonAgg>();
  const side = (uid: string): SeasonAgg => {
    let entry = agg.get(uid);
    if (!entry) {
      entry = { gf: 0, ga: 0, games: 0, draws: 0, eloGain: 0, longestWin: 0, run: 0 };
      agg.set(uid, entry);
    }
    return entry;
  };

  let giant: {
    playerId: string;
    opponentId: string;
    delta: number;
    gap: number;
    matchId: string;
  } | null = null;
  for (const match of played) {
    const a = side(match.aId);
    const b = side(match.bId);
    a.gf += match.aGoals;
    a.ga += match.bGoals;
    a.games += 1;
    a.eloGain += match.aDelta ?? 0;
    b.gf += match.bGoals;
    b.ga += match.aGoals;
    b.games += 1;
    b.eloGain += match.bDelta ?? 0;
    if (match.aGoals === match.bGoals) {
      a.draws += 1;
      b.draws += 1;
      a.run = 0;
      b.run = 0;
    } else {
      const aWon = match.aGoals > match.bGoals;
      const winner = aWon ? a : b;
      const loser = aWon ? b : a;
      winner.run += 1;
      winner.longestWin = Math.max(winner.longestWin, winner.run);
      loser.run = 0;

      const winnerBefore = aWon ? match.aEloBefore : match.bEloBefore;
      const loserBefore = aWon ? match.bEloBefore : match.aEloBefore;
      const winnerDelta = (aWon ? match.aDelta : match.bDelta) ?? 0;
      if (winnerBefore !== null && loserBefore !== null) {
        const gap = loserBefore - winnerBefore;
        if (!giant || gap > giant.gap) {
          giant = {
            playerId: aWon ? match.aId : match.bId,
            opponentId: aWon ? match.bId : match.aId,
            delta: winnerDelta,
            gap,
            matchId: match.id,
          };
        }
      }
    }
  }

  const rows = [...agg.entries()];
  const top = (score: (entry: SeasonAgg) => number): [string, SeasonAgg] =>
    rows.slice().sort((x, y) => score(y[1]) - score(x[1]))[0];

  const boot = top((entry) => entry.gf);
  const eligible = rows.filter(([, entry]) => entry.games >= GLOVE_MIN_GAMES);
  const glove = (eligible.length ? eligible : rows).slice().sort((x, y) => x[1].ga - y[1].ga)[0];
  const improved = top((entry) => entry.eloGain);
  const streaker = top((entry) => entry.longestWin);
  const drawer = top((entry) => entry.draws);

  const awards: SeasonAward[] = [
    { key: "boot", playerId: boot[0], stat: boot[1].gf, statLabel: "goals" },
    { key: "glove", playerId: glove[0], stat: glove[1].ga, statLabel: "conceded" },
    {
      key: "improved",
      playerId: improved[0],
      stat: `${improved[1].eloGain >= 0 ? "+" : ""}${improved[1].eloGain}`,
      statLabel: "ELO climb",
    },
    { key: "streak", playerId: streaker[0], stat: streaker[1].longestWin, statLabel: "in a row" },
    { key: "draw", playerId: drawer[0], stat: drawer[1].draws, statLabel: "draws" },
  ];
  if (giant) {
    awards.push({
      key: "giant",
      playerId: giant.playerId,
      stat: `${giant.delta >= 0 ? "+" : ""}${giant.delta}`,
      statLabel: `${giant.gap} ELO gap`,
      matchId: giant.matchId,
      opponentId: giant.opponentId,
    });
  }
  return awards;
}
