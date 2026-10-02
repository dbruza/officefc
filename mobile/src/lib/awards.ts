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

export { computeSeasonAwards, GLOVE_MIN_GAMES } from "../../../functions/src/models/awards";
export type { SeasonAward } from "../../../functions/src/models/awards";
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
  facts?: import("../../../functions/src/models/summaries").AchievementFacts,
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

  if (facts) {
    maxGoals = facts.maxGoals;
    cleanWins = facts.cleanWins;
    upset = facts.upset;
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
