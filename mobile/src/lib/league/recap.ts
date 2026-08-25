/**
 * Season-recap loading: reads the `recap` map finalizeSeason stamps onto the
 * seasonResults document. Types are declared here (not in types.ts) so the shared
 * type module stays untouched; the accessors below validate each section structurally,
 * so pre-recap seasons (no field) or partial recaps degrade to "section absent" instead
 * of throwing.
 */
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";

export interface GoldenBootRecap {
  playerId: string;
  goals: number;
}

export interface BestDefenseRecap {
  playerId: string;
  conceded: number;
}

export interface MostImprovedRecap {
  playerId: string;
  eloGain: number;
}

export interface WinStreakRecap {
  playerId: string;
  streak: number;
}

export interface RivalryRecap {
  /** Lexically smaller uid of the pair, as written by the server derivation. */
  aId: string;
  bId: string;
  games: number;
}

export interface GameOfTheSeasonRecap {
  matchId: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
}

export interface BiggestUpsetRecap {
  matchId: string;
  winnerId: string;
  loserId: string;
  winnerGoals: number;
  loserGoals: number;
}

/** Mirrors functions/src/seasonRecap.ts SeasonRecap: absent sections stay absent. */
export interface SeasonRecap {
  goldenBoot?: GoldenBootRecap;
  bestDefense?: BestDefenseRecap;
  mostImproved?: MostImprovedRecap;
  longestWinStreak?: WinStreakRecap;
  biggestRivalry?: RivalryRecap;
  gameOfTheSeason?: GameOfTheSeasonRecap;
  biggestUpset?: BiggestUpsetRecap;
}

const isStr = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function section(raw: unknown, check: (value: Record<string, unknown>) => boolean): boolean {
  return typeof raw === "object" && raw !== null && check(raw as Record<string, unknown>);
}

/**
 * Narrow structural accessor over an untrusted Firestore payload: a section survives only
 * when every one of its fields has the right primitive type. Anything malformed is dropped
 * rather than rendered half-populated.
 */
export function mapSeasonRecap(raw: unknown): SeasonRecap {
  if (!section(raw, () => true)) return {};
  const data = raw as Record<string, unknown>;
  const recap: SeasonRecap = {};
  if (section(data.goldenBoot, (s) => isStr(s.playerId) && isNum(s.goals))) {
    recap.goldenBoot = data.goldenBoot as GoldenBootRecap;
  }
  if (section(data.bestDefense, (s) => isStr(s.playerId) && isNum(s.conceded))) {
    recap.bestDefense = data.bestDefense as BestDefenseRecap;
  }
  if (section(data.mostImproved, (s) => isStr(s.playerId) && isNum(s.eloGain))) {
    recap.mostImproved = data.mostImproved as MostImprovedRecap;
  }
  if (section(data.longestWinStreak, (s) => isStr(s.playerId) && isNum(s.streak))) {
    recap.longestWinStreak = data.longestWinStreak as WinStreakRecap;
  }
  if (section(data.biggestRivalry, (s) => isStr(s.aId) && isStr(s.bId) && isNum(s.games))) {
    recap.biggestRivalry = data.biggestRivalry as RivalryRecap;
  }
  if (
    section(
      data.gameOfTheSeason,
      (s) => isStr(s.matchId) && isStr(s.aId) && isStr(s.bId) && isNum(s.aGoals) && isNum(s.bGoals),
    )
  ) {
    recap.gameOfTheSeason = data.gameOfTheSeason as GameOfTheSeasonRecap;
  }
  if (
    section(
      data.biggestUpset,
      (s) =>
        isStr(s.matchId) &&
        isStr(s.winnerId) &&
        isStr(s.loserId) &&
        isNum(s.winnerGoals) &&
        isNum(s.loserGoals),
    )
  ) {
    recap.biggestUpset = data.biggestUpset as BiggestUpsetRecap;
  }
  return recap;
}

/**
 * The finalized season's recap, or null when the result doc doesn't exist yet (season not
 * finalized) or carries no recap (finalized before this feature shipped).
 */
export async function loadRecap(seasonId: string): Promise<SeasonRecap | null> {
  return timed("loadRecap", async () => {
    const snap = await getDoc(doc(db, "seasonResults", seasonId));
    if (!snap.exists()) return null;
    const recap = mapSeasonRecap(snap.get("recap"));
    return Object.keys(recap).length > 0 ? recap : null;
  });
}
