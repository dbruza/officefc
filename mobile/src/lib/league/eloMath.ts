// ---------------------------------------------------------------------------
// ELO preview math — a line-for-line port of the server's pure formulas in
// functions/src/elo.ts (the source of truth for ratings). The preview and the
// commit now run the SAME formulas, so the number a player sees while logging a
// match is the number the server commits once the opponent confirms. A parity
// test (eloPreview.test.ts) recomputes each fixture through the server's
// calculateSeason and asserts agreement, so the two cannot silently drift.
//
// This module is intentionally dependency-free (no Firestore) so it stays unit-testable.
// ---------------------------------------------------------------------------

export const ELO_K = 32;
export const ELO_SCALE = 400;
export const TEAM_ELO_PER_OVERALL = 12;
export const PREMIER_HANDICAP_ELO = 100;
export const PROVISIONAL_K = 40;
export const PROVISIONAL_GAMES = 10;

export const W_GOALS = 0.6;
export const W_XG = 0.25;
export const W_POSS = 0.15;
const GOAL_MARGIN_SCALE = 2;

/** Mirror of the server's getK: new players use a higher K for their first games this season. */
export function previewK(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? PROVISIONAL_K : ELO_K;
}

function goalScore(gf: number, ga: number): number {
  const gd = gf - ga;
  return 0.5 + 0.5 * (gd / (Math.abs(gd) + GOAL_MARGIN_SCALE));
}

function share(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  const t = a + b;
  return t > 0 ? a / t : null;
}

/** Mirror of the server's performanceScore: goal margin blended with expected-goals
 *  (xG) and possession shares when both sides are known. */
export function performanceScore(m: {
  aGoals: number;
  bGoals: number;
  aXg?: number | null;
  bXg?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
}): number {
  const parts: Array<[number, number]> = [[W_GOALS, goalScore(m.aGoals, m.bGoals)]];
  const xg = share(m.aXg, m.bXg);
  if (xg != null) parts.push([W_XG, xg]);
  const poss = share(m.aPossession, m.bPossession);
  if (poss != null) parts.push([W_POSS, poss]);
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  return parts.reduce((s, [w, v]) => s + w * v, 0) / wsum;
}

/** Mirror of the server's effectiveRatings: team overalls shift each side's rating by
 *  TEAM_ELO_PER_OVERALL per overall point, only when both are known. */
export function effectiveRatings(
  aElo: number,
  bElo: number,
  aOverall: number | null | undefined,
  bOverall: number | null | undefined,
): [number, number] {
  if (aOverall == null || bOverall == null) return [aElo, bElo];
  return [aElo + TEAM_ELO_PER_OVERALL * aOverall, bElo + TEAM_ELO_PER_OVERALL * bOverall];
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / ELO_SCALE));
}

/** Optional stats that feed the performance blend, mirroring SeasonMatchInput. */
export interface PreviewStats {
  myXg?: number | null;
  opponentXg?: number | null;
  myPossession?: number | null;
  opponentPossession?: number | null;
}

/**
 * The ELO delta the server will commit for this result, computed with the exact same
 * formulas as functions/src/elo.ts. Team overalls and the reigning-Premier handicap
 * tilt the expectation exactly like the server (only when both overalls are known, and
 * only for the reigning Premier). Pass the scoring player's games-played this season
 * so new players see the provisional K; when omitted it falls back to the settled K.
 *
 * `premierId` is the season's reigning Premier; pass both uids so the handicap lands on
 * whichever side holds the title (it shifts expectation against the Premier on both sides'
 * previews). `stats` carries xG and possession when known (the Snap flow extracts them —
 * manual/auto flows have neither, matching the goals-only commit those flows produce).
 */
export function previewElo(
  myElo: number,
  opponentElo: number,
  myGoals: number,
  opponentGoals: number,
  myTeamOverall?: number | null,
  opponentTeamOverall?: number | null,
  myGamesPlayed: number = PROVISIONAL_GAMES,
  premierId?: string | null,
  myUid?: string | null,
  opponentUid?: string | null,
  stats?: PreviewStats,
): number {
  const [myEff, opponentEff] = effectiveRatings(
    myElo,
    opponentElo,
    myTeamOverall,
    opponentTeamOverall,
  );
  // The Premier handicap applies to whichever side holds the title, exactly like the server.
  const myPremier = premierId != null && premierId === myUid ? PREMIER_HANDICAP_ELO : 0;
  const opponentPremier = premierId != null && premierId === opponentUid ? PREMIER_HANDICAP_ELO : 0;
  const expected = expectedScore(myEff + myPremier, opponentEff + opponentPremier);
  const perf = performanceScore({
    aGoals: myGoals,
    bGoals: opponentGoals,
    aXg: stats?.myXg,
    bXg: stats?.opponentXg,
    aPossession: stats?.myPossession,
    bPossession: stats?.opponentPossession,
  });
  return Math.round(previewK(myGamesPlayed) * (perf - expected));
}
