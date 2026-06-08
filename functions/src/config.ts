/** Shared config for the Cloud Functions. Keep in sync with mobile/src/lib/constants.ts. */

/** Single office league id for v1. */
export const LEAGUE_ID = "office";

/** Emails auto-promoted to admin on first join (authoritative — checked server-side). */
export const ADMIN_ALLOWLIST = ["djbruza@gmail.com"];

export function isAllowlistedAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_ALLOWLIST.includes(email.toLowerCase());
}

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `OFC-${s}`;
}
