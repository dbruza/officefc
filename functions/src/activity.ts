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
  | "champion"
  | "premier"
  | "finals_set"
  | "finals_result";

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

/**
 * Every id deriveMatchActivity can give one match's events, whichever it actually produced —
 * so a result voided after confirmation can take its feed events down with it.
 */
export function matchActivityIds(matchId: string, aId: string, bId: string): string[] {
  return [
    `result_${matchId}`,
    `upset_${matchId}`,
    `streak_${matchId}_${aId}`,
    `streak_${matchId}_${bId}`,
    `numberone_${matchId}`,
  ];
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
  /** Top of the ELO table for finals-format seasons; null/absent for table-format seasons
   *  (there the champion IS the table-topper and no separate premier event is emitted). */
  premierId?: string | null;
  potm: Array<{ month: string; playerId: string; gain: number }>;
}

/** Derive the season-finalization feed events: champion, premier (finals format), POTM. */
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
  if (input.premierId) {
    events.push({
      id: `premier_${input.seasonId}`,
      type: "premier",
      seasonId: input.seasonId,
      actorIds: [input.premierId],
      payload: { playerId: input.premierId, seasonName: input.seasonName },
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

export interface FinalsSetActivityInput {
  seasonId: string;
  seasonName: string;
  /** Seed order, best first. */
  seedIds: string[];
}

/** Derive the "finals are set" announcement emitted when the bracket is locked. */
export function deriveFinalsSetActivity(input: FinalsSetActivityInput): ActivityEvent[] {
  return [
    {
      id: `finals_set_${input.seasonId}`,
      type: "finals_set",
      seasonId: input.seasonId,
      actorIds: input.seedIds,
      payload: { seedIds: input.seedIds, seasonName: input.seasonName },
    },
  ];
}

export interface FinalsResultActivityInput {
  seasonId: string;
  slotKey: string;
  label: string;
  round: "elimination" | "semi" | "final";
  winnerId: string;
  loserId: string;
  /** Null for a walkover — there was no match. */
  matchId: string | null;
  winnerGoals: number | null;
  loserGoals: number | null;
  decidedBy: "regulation" | "extra_time" | "penalties" | "walkover";
}

/** Derive the feed event for one decided finals tie. */
export function deriveFinalsResultActivity(input: FinalsResultActivityInput): ActivityEvent[] {
  return [
    {
      id: `finals_${input.seasonId}_${input.slotKey}`,
      type: "finals_result",
      seasonId: input.seasonId,
      actorIds: [input.winnerId, input.loserId],
      payload: {
        slotKey: input.slotKey,
        label: input.label,
        round: input.round,
        winnerId: input.winnerId,
        loserId: input.loserId,
        matchId: input.matchId,
        winnerGoals: input.winnerGoals,
        loserGoals: input.loserGoals,
        decidedBy: input.decidedBy,
      },
    },
  ];
}
