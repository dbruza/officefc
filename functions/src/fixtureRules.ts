/**
 * Pure team-assignment engine for auto-matchup fixtures. No Firestore dependency, so it
 * can be unit-tested in isolation; the createFixture callable in fixtures.ts feeds it
 * data and maps its errors to HttpsErrors.
 */
import { TEAM_ELO_PER_OVERALL } from "./elo";

/** Auto-matchup fixtures only deal teams inside this quality window, so nobody is ever
 *  handed a minnow: the handicap comes from the gap between the two teams, not from
 *  making either side unplayable. */
export const FIXTURE_QUALITY_MIN = 70;
export const FIXTURE_QUALITY_MAX = 86;
/** Tolerance (in OVR points) around the ELO-derived target gap when pairing teams. */
export const FIXTURE_BAND = 2;
/** Each player's teams from their last N season matches are avoided when dealing. */
export const FIXTURE_NOVELTY_WINDOW = 5;
export const FIXTURE_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const FIXTURE_MAX_REROLLS = 1;

export interface FixtureTeam {
  id: string;
  name: string;
  overall: number;
}

export interface FixtureAssignment {
  aTeam: FixtureTeam;
  bTeam: FixtureTeam;
  /** OVR gap (aTeam − bTeam) the engine aimed for, before the ±band. */
  targetDiff: number;
}

/**
 * Deal a team to each player so the matchup is a fair fight on current form.
 *
 * The target OVR gap inverts the ELO team handicap: expected score is computed from
 * `elo + TEAM_ELO_PER_OVERALL·overall`, so giving the lower-rated player a team
 * `(bElo − aElo) / TEAM_ELO_PER_OVERALL` OVR stronger levels the expectations at ~50/50.
 * Teams either player used recently are avoided (soft preference — ignored when it would
 * empty the pool), and the exact pair is random within the ±band so repeat matchups
 * still produce fresh teams.
 */
export function assignFixtureTeams(options: {
  pool: FixtureTeam[];
  aElo: number;
  bElo: number;
  aRecentTeamIds?: Set<string>;
  bRecentTeamIds?: Set<string>;
  random?: () => number;
}): FixtureAssignment {
  const { pool, aElo, bElo } = options;
  const random = options.random ?? Math.random;
  const quality = pool.filter(
    (team) => team.overall >= FIXTURE_QUALITY_MIN && team.overall <= FIXTURE_QUALITY_MAX,
  );
  if (quality.length < 2) {
    throw new Error("Not enough rated teams to deal a matchup.");
  }

  const withoutRecent = (teams: FixtureTeam[], recent?: Set<string>) => {
    if (!recent?.size) return teams;
    const fresh = teams.filter((team) => !recent.has(team.id));
    return fresh.length > 0 ? fresh : teams;
  };
  const aPool = withoutRecent(quality, options.aRecentTeamIds);
  const bPool = withoutRecent(quality, options.bRecentTeamIds);

  const span = FIXTURE_QUALITY_MAX - FIXTURE_QUALITY_MIN;
  const targetDiff = Math.max(-span, Math.min(span, (bElo - aElo) / TEAM_ELO_PER_OVERALL));

  // Widen the band until a pair exists; guaranteed to terminate because both pools are
  // non-empty and every possible gap lies within ±span of the clamped target.
  for (let band = FIXTURE_BAND; band <= span * 2; band++) {
    const pairs: Array<[FixtureTeam, FixtureTeam]> = [];
    for (const aTeam of aPool) {
      for (const bTeam of bPool) {
        if (aTeam.id === bTeam.id) continue;
        if (Math.abs(aTeam.overall - bTeam.overall - targetDiff) <= band) {
          pairs.push([aTeam, bTeam]);
        }
      }
    }
    if (pairs.length > 0) {
      const [aTeam, bTeam] = pairs[Math.floor(random() * pairs.length)];
      return { aTeam, bTeam, targetDiff };
    }
  }
  throw new Error("Could not find a team pairing.");
}
