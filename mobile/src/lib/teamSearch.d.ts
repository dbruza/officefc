import type { Team } from "./league";

export type TeamCategoryFilter = "all" | Team["category"];
export type TeamOverallFilter = "all" | "80+" | "75-79" | "70-74" | "under70" | "unrated";

export interface TeamFilters {
  query: string;
  category: TeamCategoryFilter;
  overall: TeamOverallFilter;
}

export const TEAM_ALIASES: Readonly<Record<string, string | null>>;
export function normalizeTeamSearch(value: unknown): string;
export function normalizeTeamName(value: unknown): string;
export function teamNameCore(value: unknown): string;
export function filterTeams(teams: Team[], filters: TeamFilters): Team[];
export function matchTeamName<T extends Pick<Team, "name">>(
  teams: T[],
  name: string | null | undefined,
): T | null;
