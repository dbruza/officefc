/** App-wide constants. */

/** Single office league id for v1 (matches the security rules + Cloud Functions). */
export const LEAGUE_ID = "office";

/**
 * Client-side copy of the admin allowlist — used only for UI hints (e.g. showing
 * "you'll be set up as an admin"). The AUTHORITATIVE check lives server-side in the
 * `redeemInvite` Cloud Function; never trust this for access decisions.
 */
export const ADMIN_ALLOWLIST = ["djbruza@gmail.com"];

export function isAllowlistedAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_ALLOWLIST.includes(email.toLowerCase());
}
