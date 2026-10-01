import type { ReactNode } from "react";
import type { LeaguePlayer, Season, Standing, Team } from "@/lib/league";
import type { OpponentHistory } from "@/lib/matchHistory";

/**
 * Photo flow steps. Verify and submit are one step — the old separate review screen only
 * repeated the values the player had just checked.
 */
export type SnapStep = "capture" | "processing" | "side" | "opponent" | "teams" | "verify" | "done";

/** Stages of the processing checklist, in order. */
export type SnapPhase = "uploading" | "reading" | "matching";

export interface ExtractionSuggestion {
  home: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    xg: number | null;
    team_name: string | null;
    /** Newer fields: absent on drafts extracted before 1.12. */
    shot_accuracy?: number | null;
    saves?: number | null;
    ball_recovery_time?: number | null;
    /** "derived" when shots on target came from shots × Shot Accuracy, not a printed row. */
    shots_on_target_source?: "printed" | "derived" | null;
  };
  away: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    xg: number | null;
    team_name: string | null;
    /** Newer fields: absent on drafts extracted before 1.12. */
    shot_accuracy?: number | null;
    saves?: number | null;
    ball_recovery_time?: number | null;
    /** "derived" when shots on target came from shots × Shot Accuracy, not a printed row. */
    shots_on_target_source?: "printed" | "derived" | null;
  };
  homeResult: "W" | "D" | "L" | null;
}

export interface ExtractionResult {
  ok: boolean;
  detectedScreen: boolean;
  confidence: number;
  requiresReview: boolean;
  flags: string[];
  /** Server verdict on the AI's read: goals vs shots on target − saves. */
  consistency?: { status: "ok" | "mismatch" | "unknown" } | null;
  suggestion: ExtractionSuggestion | null;
}

export interface SnapFlowProps {
  uid: string;
  profile: { displayName: string; handle: string; jersey: number; color: string };
  season: Season;
  players: LeaguePlayer[];
  teams: Team[];
  standings: Standing[];
  /** Past meetings per opponent — sorts the opponent list by recency. */
  opponentHistory?: Map<string, OpponentHistory>;
  /** The player's recent teams, newest first — seeds the team picker's Recent row. */
  myRecentTeamIds?: string[];
  /** Opponent chosen before entering the photo flow (deep link / mode switch). */
  initialOpponentId?: string | null;
  /** Mode switcher rendered on the capture step (Photo / Auto / Manual). */
  modeSwitch?: ReactNode;
  onCancel: () => void;
  /** Leave for manual entry, carrying the opponent if one was picked. */
  onManualFallback: (opponentId?: string) => void;
  onViewMatch?: (matchId: string) => void;
  onDone: () => void;
}
