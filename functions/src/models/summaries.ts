import { summarizeHistory } from "./matchHistory";
import type { LeagueMatch, Team } from "./types";
import { computeSeasonAwards } from "./awards";
import { aggregateSeasonStats } from "./seasonStats";
import { streakRows } from "./streakBoard";
import { biggestResults, fairnessBySource, mostPickedTeams, winRateByBand } from "./teamMeta";
import { computeTeamRecords } from "./teamRecord";

import { SUMMARY_VERSION } from "./version";
export { SUMMARY_VERSION } from "./version";
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export function summaryMatch(
  id: string,
  data: Record<string, unknown>,
  date: Date | null,
): LeagueMatch & { finals: boolean; rawSource: string | null } {
  const side = (key: "a" | "b") => {
    const nested = data[`${key}Stats`];
    const stats =
      nested && typeof nested === "object"
        ? (nested as Record<string, unknown>)
        : {
            possession: data[`${key}Possession`],
            shots: data[`${key}Shots`],
            shotsOnTarget: data[`${key}ShotsOnTarget`],
            xg: data[`${key}Xg`],
          };
    return {
      possession: number(stats.possession),
      shots: number(stats.shots),
      shotsOnTarget: number(stats.shotsOnTarget ?? stats.shots_on_target),
      xg: number(stats.xg),
    };
  };
  return {
    id,
    seasonId: String(data.seasonId),
    submittedBy: String(data.submittedBy),
    aId: String(data.aId),
    bId: String(data.bId),
    aTeamId: String(data.aTeamId),
    bTeamId: String(data.bTeamId),
    aTeam: String(data.aTeam),
    bTeam: String(data.bTeam),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    date,
    status: "confirmed",
    source: data.source === "ai_assisted" ? "ai_assisted" : "manual",
    rawSource: typeof data.source === "string" ? data.source : null,
    finals: data.finals === true,
    photoPath: null,
    aEloBefore: number(data.aEloBefore),
    bEloBefore: number(data.bEloBefore),
    aEloAfter: number(data.aEloAfter),
    bEloAfter: number(data.bEloAfter),
    aDelta: number(data.aDelta),
    bDelta: number(data.bDelta),
    aStats: side("a"),
    bStats: side("b"),
  };
}
type SummaryMatch = ReturnType<typeof summaryMatch>;
export function seasonSummary(matches: SummaryMatch[], teams: Map<string, Team>) {
  const statMatches = matches.map((m) => ({
    ...m,
    aPossession: m.aStats?.possession ?? null,
    bPossession: m.bStats?.possession ?? null,
    aShots: m.aStats?.shots ?? null,
    bShots: m.bStats?.shots ?? null,
    aShotsOnTarget: m.aStats?.shotsOnTarget ?? null,
    bShotsOnTarget: m.bStats?.shotsOnTarget ?? null,
    aXg: m.aStats?.xg ?? null,
    bXg: m.bStats?.xg ?? null,
  }));
  const meta = matches.map((m) => ({ ...m, source: m.rawSource }));
  return {
    version: SUMMARY_VERSION,
    matchCount: matches.length,
    regularCount: matches.filter((m) => !m.finals).length,
    goals: matches.filter((m) => !m.finals).reduce((sum, m) => sum + m.aGoals + m.bGoals, 0),
    awards: computeSeasonAwards(matches),
    stats: aggregateSeasonStats(statMatches),
    streaks: streakRows(statMatches),
    usage: mostPickedTeams(meta, teams),
    bands: winRateByBand(meta, teams),
    fairness: fairnessBySource(meta, teams),
    bigResults: biggestResults(meta).map((m) => ({ ...m, date: m.date?.toISOString() ?? null })),
  };
}
export type SeasonSummary = ReturnType<typeof seasonSummary>;
export interface AchievementFacts {
  maxGoals: number;
  cleanWins: number;
  upset: boolean;
}
export function playerSummary(uid: string, matches: LeagueMatch[], teams: Map<string, Team>) {
  const facts: AchievementFacts = { maxGoals: 0, cleanWins: 0, upset: false };
  const seasons: Record<string, { w: number; d: number; l: number }> = {};
  for (const m of matches) {
    const mine = m.aId === uid,
      gf = mine ? m.aGoals : m.bGoals,
      ga = mine ? m.bGoals : m.aGoals;
    facts.maxGoals = Math.max(facts.maxGoals, gf);
    if (gf > ga) {
      if (ga === 0) facts.cleanWins++;
      const me = mine ? m.aEloBefore : m.bEloBefore,
        them = mine ? m.bEloBefore : m.aEloBefore;
      if (me !== null && them !== null && them > me) facts.upset = true;
    }
    const row = (seasons[m.seasonId] ??= { w: 0, d: 0, l: 0 });
    if (gf > ga) row.w++;
    else if (gf < ga) row.l++;
    else row.d++;
  }
  const records = computeTeamRecords(uid, matches, teams);
  const history = summarizeHistory(matches, uid);
  return {
    version: SUMMARY_VERSION,
    facts,
    history: { myTeamIds: history.myTeamIds, opponents: Object.fromEntries(history.opponents) },
    seasons,
    matchCount: matches.length,
    teams: records.teams.map((t) => ({ ...t, lastPlayed: t.lastPlayed?.toISOString() ?? null })),
    favouriteId: records.favourite?.teamId ?? null,
    bestId: records.best?.teamId ?? null,
  };
}
export type PlayerSummary = ReturnType<typeof playerSummary>;
