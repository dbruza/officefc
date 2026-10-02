export type MatchResult = "W" | "D" | "L";
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
  xg?: number | null;
  /** Photo-logged matches from 1.12 on. */
  saves?: number | null;
  ballRecoveryTime?: number | null;
}
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
