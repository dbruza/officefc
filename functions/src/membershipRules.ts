/**
 * Pure decision for whether a season (already located by a valid join code) can still be joined.
 * No Firestore dependency, so it is unit-testable; redeemInvite maps the result to an HttpsError.
 */

export type SeasonJoinRejection = "inactive" | "finalized";

/**
 * Why the season may NOT be joined, or null if it can. A season that is both inactive and
 * finalized reports "inactive" first, matching the order redeemInvite reveals the errors.
 */
export function seasonJoinRejection(season: {
  active?: unknown;
  finalized?: unknown;
}): SeasonJoinRejection | null {
  if (!season.active) return "inactive";
  if (season.finalized) return "finalized";
  return null;
}
