/**
 * Season awards & personal achievements, derived client-side from confirmed
 * matches (mirrors the prototype's data engine). The server stays the source
 * of truth for ratings; these are read-only decorations over match data.
 */
import type { IconName } from "@/components/Icon";
import type { LeagueMatch, PlayerStats } from "./league";

export type AwardKey = "boot" | "glove" | "improved" | "streak" | "draw" | "giant";

export interface AwardMeta {
  title: string;
  desc: string;
  icon: IconName;
  accent: string;
}

export const AWARD_META: Record<AwardKey, AwardMeta> = {
  boot: { title: "Golden Boot", desc: "Most goals scored", icon: "boot", accent: "#f5b400" },
  glove: { title: "Golden Glove", desc: "Fewest goals conceded", icon: "glove", accent: "#3fd0c9" },
  improved: { title: "Most Improved", desc: "Biggest ELO climb", icon: "trend", accent: "#5b9dff" },
  streak: {
    title: "Streak Champion",
    desc: "Longest winning streak",
    icon: "flame",
    accent: "#ff6b35",
  },
  draw: {
    title: "Draw Specialist",
    desc: "Master of the stalemate",
    icon: "handshake",
    accent: "#9aa6b4",
  },
  giant: { title: "Giant Killer", desc: "Biggest upset win", icon: "swords", accent: "#c06bff" },
} as const;

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

export interface Achievement {
  key: string;
  name: string;
  desc: string;
  icon: IconName;
  accent: string;
  cur: number;
  goal: number;
  /** Binary unlock — no meaningful progress bar. */
  oneShot?: boolean;
  unlocked: boolean;
  pct: number;
}

/**
 * The eight profile badges. `stats` is the server-computed all-time read model;
 * `matches` (the player's confirmed games) covers the per-match facts the read
 * model doesn't track (best haul, clean-sheet wins, upsets).
 */
export function computeAchievements(
  uid: string,
  stats: PlayerStats | null,
  matches: LeagueMatch[],
): Achievement[] {
  let maxGoals = 0;
  let cleanWins = 0;
  let upset = false;
  for (const match of matches) {
    const mine = match.aId === uid;
    const gf = mine ? match.aGoals : match.bGoals;
    const ga = mine ? match.bGoals : match.aGoals;
    maxGoals = Math.max(maxGoals, gf);
    if (gf > ga) {
      if (ga === 0) cleanWins += 1;
      const myBefore = mine ? match.aEloBefore : match.bEloBefore;
      const oppBefore = mine ? match.bEloBefore : match.aEloBefore;
      if (myBefore !== null && oppBefore !== null && oppBefore > myBefore) upset = true;
    }
  }

  const defs: Array<Omit<Achievement, "unlocked" | "pct">> = [
    {
      key: "hattrick",
      name: "Hat-trick Hero",
      desc: "Score 3+ in one game",
      icon: "target",
      accent: "#f5b400",
      cur: maxGoals,
      goal: 3,
    },
    {
      key: "giant",
      name: "Giant Killer",
      desc: "Beat a stronger rival",
      icon: "swords",
      accent: "#c06bff",
      cur: upset ? 1 : 0,
      goal: 1,
      oneShot: true,
    },
    {
      key: "fire",
      name: "On Fire",
      desc: "Win 3 in a row",
      icon: "flame",
      accent: "#ff6b35",
      cur: stats?.longestWin ?? 0,
      goal: 3,
    },
    {
      key: "wall",
      name: "The Wall",
      desc: "3 clean-sheet wins",
      icon: "shield",
      accent: "#3fd0c9",
      cur: cleanWins,
      goal: 3,
    },
    {
      key: "sniper",
      name: "Sharp Shooter",
      desc: "Score 20 goals",
      icon: "crosshair",
      accent: "#22e06a",
      cur: stats?.gf ?? 0,
      goal: 20,
    },
    {
      key: "vet",
      name: "Veteran",
      desc: "Play 15 games",
      icon: "award",
      accent: "#9aa7ff",
      cur: stats?.games ?? 0,
      goal: 15,
    },
    {
      key: "unbeaten",
      name: "Untouchable",
      desc: "5-game unbeaten run",
      icon: "bolt",
      accent: "#5b9dff",
      cur: stats?.longestUnbeaten ?? 0,
      goal: 5,
    },
    {
      key: "drawspec",
      name: "Draw Specialist",
      desc: "Draw 3 games",
      icon: "handshake",
      accent: "#9aa6b4",
      cur: stats?.d ?? 0,
      goal: 3,
    },
  ];

  return defs
    .map((def) => ({
      ...def,
      unlocked: def.cur >= def.goal,
      pct: Math.min(100, Math.round((def.cur / def.goal) * 100)),
    }))
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.pct - a.pct);
}
