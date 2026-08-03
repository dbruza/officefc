/**
 * Per-team playing record, derived client-side from a player's confirmed matches.
 * Every match document carries the team each side picked, so the whole breakdown —
 * favourite team, win rate, rating swing — comes from data the profile already loads.
 * The team catalogue is optional decoration (competition + OVR) and never gates a row.
 */
import type { MatchResult } from "@/types";
import type { LeagueMatch, Team } from "./league";

/** Results kept per team, oldest → newest so FormChips fades in the right direction. */
const FORM_LENGTH = 5;

/** A team needs this many games before it can be crowned the best performer. */
export const BEST_TEAM_MIN_GAMES = 3;

/** Fallback bucket when a legacy match recorded neither a team id nor a name. */
const UNKNOWN_TEAM = "Unknown team";

export interface TeamRecord {
  /** Catalogue team id when the match carried one, else a name-derived key. */
  teamId: string;
  name: string;
  competition: string | null;
  overall: number | null;
  games: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  /** Whole-percent win rate, matching the server's all-time stat. */
  winRate: number;
  /** Total rating swing with this team (legs without a recorded delta count as 0). */
  eloDelta: number;
  /** Rating swing per game, to one decimal. */
  eloPerGame: number;
  /** Last five results with this team, oldest → newest. */
  form: MatchResult[];
  lastPlayed: Date | null;
}

export interface TeamRecordSummary {
  /** Most-played team; ties break on win rate, then rating swing. */
  favourite: TeamRecord | null;
  /** Best win rate among teams with at least BEST_TEAM_MIN_GAMES games. */
  best: TeamRecord | null;
  /** Every team played, most-played first. */
  teams: TeamRecord[];
}

interface Tally extends Omit<TeamRecord, "winRate" | "eloPerGame" | "form"> {
  results: MatchResult[];
}

/** `mapMatch` coerces missing Firestore fields with String(), so guard the stringified blanks. */
function present(value: string | null | undefined): value is string {
  return !!value && value !== "undefined" && value !== "null";
}

function emptyTally(teamId: string, name: string): Tally {
  return {
    teamId,
    name,
    competition: null,
    overall: null,
    games: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    eloDelta: 0,
    results: [],
    lastPlayed: null,
  };
}

/**
 * Aggregate a player's confirmed matches by the team they used. `matches` may arrive in
 * any order; `teamsById` (the live catalogue) only supplies competition and OVR.
 */
export function computeTeamRecords(
  uid: string,
  matches: LeagueMatch[],
  teamsById?: Map<string, Team>,
): TeamRecordSummary {
  const tallies = new Map<string, Tally>();
  const played = matches
    .filter((match) => match.aId === uid || match.bId === uid)
    .slice()
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

  for (const match of played) {
    const mine = match.aId === uid;
    const rawId = mine ? match.aTeamId : match.bTeamId;
    const rawName = mine ? match.aTeam : match.bTeam;
    const teamId = present(rawId) ? rawId : "";
    const name = present(rawName) ? rawName : "";
    const key = teamId || (name ? `name:${name.toLowerCase()}` : "unknown");

    let tally = tallies.get(key);
    if (!tally) {
      tally = emptyTally(key, name || UNKNOWN_TEAM);
      tallies.set(key, tally);
    }
    // The catalogue holds the canonical name; match docs keep whatever it was called then.
    const catalogueTeam = teamId ? teamsById?.get(teamId) : undefined;
    if (catalogueTeam) {
      tally.name = catalogueTeam.name || tally.name;
      tally.competition = catalogueTeam.competition || null;
      tally.overall = catalogueTeam.overall;
    } else if (name) {
      tally.name = name;
    }

    const gf = mine ? match.aGoals : match.bGoals;
    const ga = mine ? match.bGoals : match.aGoals;
    const result: MatchResult = gf > ga ? "W" : gf < ga ? "L" : "D";
    tally.games += 1;
    tally.gf += gf;
    tally.ga += ga;
    tally.eloDelta += (mine ? match.aDelta : match.bDelta) ?? 0;
    if (result === "W") tally.w += 1;
    else if (result === "L") tally.l += 1;
    else tally.d += 1;
    tally.results.push(result);
    if (match.date && (!tally.lastPlayed || match.date > tally.lastPlayed)) {
      tally.lastPlayed = match.date;
    }
  }

  const teams = [...tallies.values()]
    .map(({ results, ...tally }) => ({
      ...tally,
      winRate: tally.games ? Math.round((tally.w / tally.games) * 100) : 0,
      eloPerGame: tally.games ? Math.round((tally.eloDelta / tally.games) * 10) / 10 : 0,
      form: results.slice(-FORM_LENGTH),
    }))
    .sort(
      (a, b) =>
        b.games - a.games ||
        b.winRate - a.winRate ||
        b.eloDelta - a.eloDelta ||
        a.name.localeCompare(b.name),
    );

  const ranked = teams
    .filter((team) => team.games >= BEST_TEAM_MIN_GAMES)
    .sort(
      (a, b) =>
        b.winRate - a.winRate ||
        b.eloPerGame - a.eloPerGame ||
        b.games - a.games ||
        a.name.localeCompare(b.name),
    );
  // "Best" has to mean something: it needs rivals to beat (one qualifying team wins by
  // default, however badly it played) and a winning record of its own.
  const contender = ranked[0];
  const best = ranked.length >= 2 && contender.w > contender.l ? contender : null;

  return { favourite: teams[0] ?? null, best, teams };
}
