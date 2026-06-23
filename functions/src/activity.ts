/**
 * Pure derivation of league activity-feed events. No I/O, no firebase-admin imports —
 * the same discipline as elo.ts/stats.ts — so it is exhaustively unit-testable. The thin
 * IO layer in activityFeed.ts reads the inputs, calls these functions, and persists the
 * results with deterministic document IDs.
 */

export type ActivityType =
  | "match_result"
  | "upset"
  | "streak"
  | "new_number_one"
  | "potm"
  | "champion";

export interface ActivityEvent {
  /** Deterministic document id — re-deriving the same event yields the same id (idempotent). */
  id: string;
  type: ActivityType;
  seasonId: string | null;
  /** Players involved, for a future "your activity" filter. */
  actorIds: string[];
  payload: Record<string, unknown>;
}

/** A winner needs to start at least this far below the loser for the result to be an "upset". */
export const UPSET_ELO_GAP = 100;
/** Win-streak lengths that earn a feed shout-out. */
export const STREAK_MILESTONES = [3, 5, 10];

export interface MatchActivityInput {
  matchId: string;
  seasonId: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  aEloBefore: number;
  bEloBefore: number;
  aDelta: number;
  bDelta: number;
  /** The match winner's current win-streak length AFTER this match (null on a draw). */
  winnerStreak: number | null;
  /** The match winner's current streak type AFTER this match — only "W" earns a streak event. */
  winnerStreakType: "W" | "D" | "L" | null;
  /** Season rank-1 ranked player BEFORE this match's recalc (null if there was none). */
  previousLeaderId: string | null;
  /** Season rank-1 ranked player AFTER this match's recalc (null if there is none yet). */
  newLeaderId: string | null;
}

/** Derive every feed event produced by a single confirmed match. */
export function deriveMatchActivity(input: MatchActivityInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const actors = [input.aId, input.bId];

  events.push({
    id: `result_${input.matchId}`,
    type: "match_result",
    seasonId: input.seasonId,
    actorIds: actors,
    payload: {
      matchId: input.matchId,
      aId: input.aId,
      bId: input.bId,
      aGoals: input.aGoals,
      bGoals: input.bGoals,
      aDelta: input.aDelta,
      bDelta: input.bDelta,
    },
  });

  const winnerIsA = input.aGoals > input.bGoals;
  const winnerIsB = input.bGoals > input.aGoals;
  const winnerId = winnerIsA ? input.aId : winnerIsB ? input.bId : null;

  if (winnerId) {
    const loserId = winnerIsA ? input.bId : input.aId;
    const winnerEloBefore = winnerIsA ? input.aEloBefore : input.bEloBefore;
    const loserEloBefore = winnerIsA ? input.bEloBefore : input.aEloBefore;
    const gap = loserEloBefore - winnerEloBefore;
    if (gap >= UPSET_ELO_GAP) {
      events.push({
        id: `upset_${input.matchId}`,
        type: "upset",
        seasonId: input.seasonId,
        actorIds: [winnerId, loserId],
        payload: {
          matchId: input.matchId,
          winnerId,
          loserId,
          winnerEloBefore,
          loserEloBefore,
          gap,
        },
      });
    }

    if (
      input.winnerStreakType === "W" &&
      input.winnerStreak !== null &&
      STREAK_MILESTONES.includes(input.winnerStreak)
    ) {
      events.push({
        id: `streak_${input.matchId}_${winnerId}`,
        type: "streak",
        seasonId: input.seasonId,
        actorIds: [winnerId],
        payload: { playerId: winnerId, count: input.winnerStreak },
      });
    }
  }

  if (input.newLeaderId && input.newLeaderId !== input.previousLeaderId) {
    events.push({
      id: `numberone_${input.matchId}`,
      type: "new_number_one",
      seasonId: input.seasonId,
      actorIds: input.previousLeaderId
        ? [input.newLeaderId, input.previousLeaderId]
        : [input.newLeaderId],
      payload: { playerId: input.newLeaderId, previousLeaderId: input.previousLeaderId },
    });
  }

  return events;
}

export interface SeasonActivityInput {
  seasonId: string;
  seasonName: string;
  championId: string | null;
  runnerUpId: string | null;
  potm: Array<{ month: string; playerId: string; gain: number }>;
}

/** Derive the season-finalization feed events: one champion, one POTM per month. */
export function deriveSeasonActivity(input: SeasonActivityInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  if (input.championId) {
    events.push({
      id: `champion_${input.seasonId}`,
      type: "champion",
      seasonId: input.seasonId,
      actorIds: [input.championId],
      payload: {
        playerId: input.championId,
        runnerUpId: input.runnerUpId,
        seasonName: input.seasonName,
      },
    });
  }
  for (const potm of input.potm) {
    events.push({
      id: `potm_${input.seasonId}_${potm.month}`,
      type: "potm",
      seasonId: input.seasonId,
      actorIds: [potm.playerId],
      payload: { playerId: potm.playerId, month: potm.month, gain: potm.gain },
    });
  }
  return events;
}
