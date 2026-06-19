import type { LeaguePlayer, Season, Standing, Team } from "@/lib/league";

export type SnapStep =
  | "capture"
  | "processing"
  | "side"
  | "opponent"
  | "teams"
  | "prefill"
  | "review"
  | "submitting"
  | "done";

export interface ExtractionSuggestion {
  home: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    team_name: string | null;
  };
  away: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    team_name: string | null;
  };
  homeResult: "W" | "D" | "L" | null;
}

export interface ExtractionResult {
  ok: boolean;
  detectedScreen: boolean;
  confidence: number;
  requiresReview: boolean;
  flags: string[];
  suggestion: ExtractionSuggestion | null;
}

export interface SnapFlowProps {
  uid: string;
  profile: { displayName: string; handle: string; jersey: number; color: string };
  season: Season;
  players: LeaguePlayer[];
  teams: Team[];
  standings: Standing[];
  onCancel: () => void;
  onManualFallback: () => void;
  onDone: () => void;
}
