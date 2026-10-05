/**
 * App-wide constants. Per-deployment values come from `EXPO_PUBLIC_*` variables
 * (mobile/.env, or EAS environment variables for native builds) — see mobile/.env.example.
 * Expo inlines them at build time, so each must be read as a literal `process.env.X`.
 */

/** Single office league id for v1 (matches the security rules + Cloud Functions). */
export const LEAGUE_ID = "office";

/** Shown on the support page and in the privacy policy and terms. */
export const SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || "officefc-support@example.com";

/** Who runs this deployment, as it reads in the privacy policy and terms ("run by …"). */
export const OPERATOR_NAME =
  process.env.EXPO_PUBLIC_OPERATOR_NAME?.trim() || "the organisers of your league";

/** Where Firestore keeps league data, as the privacy policy names it ("Sydney, Australia"). */
export const DATA_LOCATION = process.env.EXPO_PUBLIC_DATA_LOCATION?.trim() || "";

/** Region the Cloud Functions are deployed to — must match FUNCTIONS_REGION. */
export const FUNCTIONS_REGION = process.env.EXPO_PUBLIC_FUNCTIONS_REGION?.trim() || "us-central1";

/**
 * AI photo reading and match analysis. Only on when the backend deploys those functions
 * (AI_FEATURES=true); off, the app offers manual logging only.
 */
export const AI_FEATURES = /^(1|true)$/i.test(process.env.EXPO_PUBLIC_AI_FEATURES?.trim() ?? "");

/**
 * Public web address, for links shared from native apps (which have no origin of their
 * own). Defaults to the project's Firebase Hosting domain.
 */
export const WEB_APP_URL = (
  process.env.EXPO_PUBLIC_WEB_URL?.trim() ||
  `https://${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID}.web.app`
).replace(/\/+$/, "");
