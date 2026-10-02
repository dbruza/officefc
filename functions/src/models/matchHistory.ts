/**
 * What the log-match flow can infer from the player's own confirmed results: who they
 * play most recently/often (to sort the opponent list) and which teams they reach for
 * (to default "Your team" and seed the picker's Recent row). Pure — fed by
 * getPlayerMatches, which the flow already loads.
 */
import type { LeagueMatch } from "./types";

export interface OpponentHistory {
  count: number;
  /** Epoch ms of the latest meeting, or null when undated. */
  lastAt: number | null;
  /** Teams this opponent used against me, newest first, distinct. */
  teamIds: string[];
}

export interface MatchHistorySummary {
  opponents: Map<string, OpponentHistory>;
  /** My teams across all opponents, newest first, distinct. */
  myTeamIds: string[];
}

export const EMPTY_HISTORY: MatchHistorySummary = { opponents: new Map(), myTeamIds: [] };

export function summarizeHistory(matches: LeagueMatch[], uid: string): MatchHistorySummary {
  const opponents = new Map<string, OpponentHistory>();
  const myTeamIds: string[] = [];
  const newestFirst = matches
    .slice()
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  for (const match of newestFirst) {
    const iAmA = match.aId === uid;
    if (!iAmA && match.bId !== uid) continue;
    const opponentId = iAmA ? match.bId : match.aId;
    const myTeam = iAmA ? match.aTeamId : match.bTeamId;
    const theirTeam = iAmA ? match.bTeamId : match.aTeamId;
    if (myTeam && !myTeamIds.includes(myTeam)) myTeamIds.push(myTeam);
    const entry = opponents.get(opponentId) ?? {
      count: 0,
      lastAt: match.date?.getTime() ?? null,
      teamIds: [],
    };
    entry.count += 1;
    if (theirTeam && !entry.teamIds.includes(theirTeam)) entry.teamIds.push(theirTeam);
    opponents.set(opponentId, entry);
  }
  return { opponents, myTeamIds };
}
