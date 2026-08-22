/**
 * Shared reader and validator for the public web Firebase config in `mobile/.env`.
 *
 * The pre-build validation and the post-build bundle check need the same values and the
 * same notion of "this is a placeholder", so the parser lives here instead of being
 * duplicated between them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PRODUCTION_PROJECT_ID = "office-fc";

export const REQUIRED_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];

/**
 * The stand-ins `.github/workflows/ci.yml` writes into `mobile/.env` so CI can bundle
 * without secrets. Shipping one is not a degraded build, it is a dead one: Identity
 * Toolkit rejects the key with 400 API_KEY_INVALID, so every sign-in and every token
 * refresh fails. A v1.4.1.0 deploy went out carrying these and locked the whole league
 * out of the web app.
 *
 * This list only names today's literals. The shape rules below are what actually close
 * the class — a new stand-in nobody added here still fails them.
 */
export const CI_PLACEHOLDERS = ["ci-api-key", "000000000000", "1:000000000000:web:ci"];

/**
 * Set by CI, which deliberately builds against the placeholders above to prove the bundle
 * compiles without handing the workflow real credentials. Never set for a deploy.
 */
export const allowPlaceholderConfig = process.env.OFFICEFC_ALLOW_PLACEHOLDER_CONFIG === "1";

/** Firebase browser keys are always "AIza" + 35 URL-safe characters. */
const API_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;
/** A bare hostname — catches a value pasted with its https:// prefix or a trailing path. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const SENDER_ID_PATTERN = /^[1-9][0-9]{4,}$/;
const APP_ID_PATTERN = /^1:([1-9][0-9]*):web:[0-9a-f]+$/i;
/** The two suffixes the console hands out; `.env.example` warns these get mixed up. */
const BUCKET_SUFFIXES = [".firebasestorage.app", ".appspot.com"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

/** Merged env for the web build, or `null` when `mobile/.env` is missing. */
export function readWebEnv() {
  try {
    return { ...process.env, ...parseEnv(readFileSync(resolve("mobile/.env"), "utf8")) };
  } catch {
    return null;
  }
}

/**
 * Every reason `values` cannot produce a working production bundle, as printable lines.
 * Empty means good to build. Reports all problems at once so a half-filled `.env` takes
 * one round trip to the Firebase console instead of six.
 *
 * `allowPlaceholders` is CI's opt-out: it stands down the credential-realism rules only.
 * Project and emulator targeting stay enforced everywhere.
 */
export function validateWebEnv(values, { allowPlaceholders = false } = {}) {
  const problems = [];

  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length) {
    // Shape rules on absent values would only restate this, so stop here.
    return [`Missing production web variables: ${missing.join(", ")}`];
  }

  const projectId = values.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (projectId !== PRODUCTION_PROJECT_ID) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_PROJECT_ID must be ${PRODUCTION_PROJECT_ID} for the MVP production build.`,
    );
  }
  if (values.EXPO_PUBLIC_USE_EMULATORS !== "0") {
    problems.push("EXPO_PUBLIC_USE_EMULATORS must be exactly 0 for a production web build.");
  }

  if (allowPlaceholders) return problems;

  // Present-and-non-empty is not the same as usable: the CI placeholders satisfy every
  // check above and still produce a bundle nobody can sign in to.
  const placeholders = REQUIRED_KEYS.filter((key) => CI_PLACEHOLDERS.includes(values[key]));
  if (placeholders.length) {
    problems.push(
      `mobile/.env still holds CI placeholder values: ${placeholders.join(", ")}. ` +
        "Restore the real config from Firebase console → Project settings → Your apps → Web app.",
    );
  }

  const apiKey = values.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!API_KEY_PATTERN.test(apiKey)) {
    problems.push(
      "EXPO_PUBLIC_FIREBASE_API_KEY is not a Firebase browser key (expected AIza + 35 characters). " +
        "Sign-in would fail for every user with 400 API_KEY_INVALID.",
    );
  }

  const senderId = values.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  if (!SENDER_ID_PATTERN.test(senderId)) {
    problems.push(
      "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID must be the numeric sender ID from the console.",
    );
  }

  const appId = values.EXPO_PUBLIC_FIREBASE_APP_ID;
  const appIdMatch = APP_ID_PATTERN.exec(appId);
  if (!appIdMatch) {
    problems.push("EXPO_PUBLIC_FIREBASE_APP_ID must look like 1:<sender id>:web:<hex>.");
  } else if (SENDER_ID_PATTERN.test(senderId) && appIdMatch[1] !== senderId) {
    // Each console block is internally consistent; a mismatch means the six values were
    // assembled from two different apps or projects and the bundle talks to neither.
    problems.push(
      `EXPO_PUBLIC_FIREBASE_APP_ID carries sender ID ${appIdMatch[1]} but ` +
        `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID is ${senderId} — copy all six values from one app.`,
    );
  }

  const authDomain = values.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (!HOSTNAME_PATTERN.test(authDomain)) {
    problems.push(
      "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN must be a bare hostname (no https://, no trailing path).",
    );
  } else if (
    /\.(firebaseapp\.com|web\.app)$/i.test(authDomain) &&
    authDomain.split(".")[0] !== projectId
  ) {
    // A custom auth domain is legitimate, a Firebase-owned one belonging to another
    // project is not — that is a config copied from the wrong console tab.
    problems.push(
      `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN (${authDomain}) belongs to a different Firebase project than ${projectId}.`,
    );
  }

  const bucket = values.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!BUCKET_SUFFIXES.some((suffix) => bucket.toLowerCase().endsWith(suffix))) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET must end with ${BUCKET_SUFFIXES.join(" or ")} — ` +
        "copy whatever the console shows rather than typing it.",
    );
  } else if (bucket.split(".")[0] !== projectId) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET (${bucket}) belongs to a different Firebase project than ${projectId}.`,
    );
  }

  return problems;
}

/** True when `bundle` contains `value` as a whole string literal, in any quote style. */
function inlinesLiteral(bundle, value) {
  return new RegExp(`["'\`]${escapeRegExp(value)}["'\`]`).test(bundle);
}

/**
 * Which required keys the emitted bundles do NOT carry the `mobile/.env` value for.
 * A non-empty result means the export reused a stale transform.
 */
export function findMissingInlinedKeys(bundleSources, values) {
  return REQUIRED_KEYS.filter(
    (key) => !bundleSources.some((source) => inlinesLiteral(source, values[key])),
  );
}

/** Which known CI placeholders the emitted bundles would ship to users. */
export function findShippedPlaceholders(bundleSources) {
  return CI_PLACEHOLDERS.filter((value) =>
    bundleSources.some((source) => inlinesLiteral(source, value)),
  );
}
