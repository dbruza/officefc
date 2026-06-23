import type { MatchResult, Player } from "@/types";
import type { Role } from "../profiles";

export interface Season {
  id: string;
  name: string;
  year: number;
  start: Date;
  end: Date;
  active: boolean;
}

export interface SeasonResult {
  seasonId: string;
  championId: string;
  runnerUpId: string;
  finalizedAt: Date | null;
}

export interface PotmResult {
  month: string;
  playerId: string;
}

export interface Team {
  id: string;
  name: string;
  competition: string;
  category: "men" | "international" | "custom";
  overall: number | null;
  attack: number | null;
  midfield: number | null;
  defence: number | null;
  catalogueVersion: string | null;
  source: "catalogue" | "custom";
  catalogueActive: boolean;
  active: boolean;
}

export interface LeaguePlayer extends Player {
  role: Role;
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
  /** True once the player has played enough games to hold a ranked place; provisional otherwise. */
  ranked: boolean;
}

export interface PendingMatch {
  id: string;
  seasonId: string;
  submittedBy: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  status: "pending_confirmation";
  date: Date | null;
}

export interface LeagueMatch {
  id: string;
  seasonId: string;
  submittedBy: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  status: "pending_confirmation" | "confirmed" | "disputed" | "voided";
  source: "manual" | "ai_assisted";
  date: Date | null;
  photoPath: string | null;
  aEloBefore: number | null;
  aEloAfter: number | null;
  aDelta: number | null;
  bEloBefore: number | null;
  bEloAfter: number | null;
  bDelta: number | null;
  aStats?: MatchSideStats;
  bStats?: MatchSideStats;
  eloExplain?: EloExplain;
}

export interface MatchSideStats {
  possession?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
}

/** How each side's ELO delta was produced — mirrors functions/src/elo.ts EloExplain. */
export interface EloExplain {
  aExpected: number;
  bExpected: number;
  perfA: number;
  perfB: number;
  aTeamAdj: number;
  bTeamAdj: number;
  aK: number;
  bK: number;
}

export interface EloHistoryPoint {
  matchId: string | null;
  date: Date;
  rating: number;
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
  currentStreakType: MatchResult | null;
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

export interface H2HMeeting {
  matchId: string;
  seasonId: string;
  date: Date | null;
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
  meetings: H2HMeeting[];
}

export type ActivityType =
  | "match_result"
  | "upset"
  | "streak"
  | "new_number_one"
  | "potm"
  | "champion";

/** One entry in the league activity feed. Payload holds uids + facts; names resolve client-side. */
export interface ActivityEvent {
  id: string;
  type: ActivityType;
  seasonId: string | null;
  actorIds: string[];
  createdAt: Date | null;
  payload: Record<string, unknown>;
}

export interface SubmitMatchInput {
  seasonId: string;
  submittedBy: string;
  opponentId: string;
  myTeam: Team;
  opponentTeam: Team;
  myGoals: number;
  opponentGoals: number;
}

export interface TeamCatalogueSyncResult {
  version: string;
  updated: number;
  deactivated: number;
  deleted: number;
  active: number;
  skipped: boolean;
}

export interface AiAssistedSubmitInput {
  draftId: string;
  seasonId: string;
  opponentId: string;
  mySide: "home" | "away";
  myTeamId: string;
  opponentTeamId: string;
  submittedGoalsAndStats: {
    myGoals: number;
    opponentGoals: number;
    myPossession?: number | null;
    opponentPossession?: number | null;
    myShots?: number | null;
    opponentShots?: number | null;
    myShotsOnTarget?: number | null;
    opponentShotsOnTarget?: number | null;
  };
}

export interface AdminPendingMatch {
  id: string;
  status: "pending_confirmation" | "disputed";
  submittedBy: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  aTeam: string;
  bTeam: string;
  date: Date | null;
  source: "manual" | "ai_assisted";
  photoPath: string | null;
  disputedBy: string | null;
  disputeReason: string | null;
}
