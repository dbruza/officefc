import type { Team } from "./league";

export type TeamCategoryFilter = "all" | Team["category"];
export type TeamOverallFilter = "all" | "80+" | "75-79" | "70-74" | "under70" | "unrated";

export interface TeamFilters {
  query: string;
  category: TeamCategoryFilter;
  overall: TeamOverallFilter;
}

export function normalizeTeamSearch(value: unknown): string;
export function filterTeams(teams: Team[], filters: TeamFilters): Team[];
