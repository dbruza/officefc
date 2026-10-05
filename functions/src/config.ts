/** Shared config for the Cloud Functions. Keep in sync with mobile/src/lib/constants.ts. */
import { randomInt } from "node:crypto";
import { defineBoolean, defineString } from "firebase-functions/params";

/** Single office league id for v1. */
export const LEAGUE_ID = "office";

/*
 * Per-deployment settings. Firebase resolves these at deploy time from
 * functions/.env.<projectId> and prompts for any that are missing, saving the answers
 * there — see functions/.env.example.
 */

/** Region every function runs in (applied globally in index.ts). Mirror it in the app. */
export const FUNCTIONS_REGION = defineString("FUNCTIONS_REGION", {
  default: "us-central1",
  description:
    "Region for every Cloud Function. Pick the one closest to your Firestore database, and set the same value as EXPO_PUBLIC_FUNCTIONS_REGION in mobile/.env.",
});

/**
 * Emails auto-promoted to admin on first join (authoritative — checked server-side). A
 * comma-separated string rather than a list param: the emulator hands list params to the
 * code as the raw `.env` text while deploys hand them over as JSON.
 */
export const ADMIN_EMAILS = defineString("ADMIN_EMAILS", {
  default: "",
  description:
    "Comma-separated emails that join as league admins without a code. The first admin bootstraps the league.",
});

/**
 * Deploys the OpenRouter-backed functions (photo stats extraction, match analysis). Off by
 * default so a deployment needs no OpenRouter account; when on, set the
 * OPENROUTER_API_KEY secret and EXPO_PUBLIC_AI_FEATURES=1 in the app.
 */
export const AI_FEATURES = defineBoolean("AI_FEATURES", {
  default: false,
  description:
    "Deploy AI photo reading and match analysis (needs the OPENROUTER_API_KEY secret and EXPO_PUBLIC_AI_FEATURES=1 in the app).",
});

/** `omit` option for functions that only exist when AI_FEATURES is on. */
export const OMIT_UNLESS_AI = AI_FEATURES.equals(false);

/**
 * The Secret Manager secret those functions bind. Named rather than `defineSecret`-ed: a
 * declared secret param must exist at every deploy, even when its functions are omitted.
 */
export const OPENROUTER_SECRET = "OPENROUTER_API_KEY";

export function openRouterApiKey(): string {
  return process.env[OPENROUTER_SECRET] ?? "";
}

export function isAllowlistedAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowlist = ADMIN_EMAILS.value()
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `OFC-${s}`;
}
