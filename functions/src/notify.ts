import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: Record<string, string>;
}

/** A raw value is a usable push target only if it's a string in Expo's token format. */
function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^(ExponentPushToken|ExpoPushToken)\[/.test(value);
}

/** Shape the Expo payloads for a batch of raw token values, dropping anything malformed. */
export function buildPushMessages(
  tokenValues: unknown[],
  title: string,
  body: string,
  data: Record<string, string>,
): PushMessage[] {
  return tokenValues
    .filter(isExpoPushToken)
    .map((to) => ({ to, sound: "default", title, body, data }));
}

/**
 * POST the batch to Expo, swallowing transport errors on purpose: a failed push must never
 * fail the caller's main action (e.g. confirming a match). Returns whether a request was sent.
 */
export async function deliverPushMessages(
  messages: PushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (messages.length === 0) return false;
  try {
    await fetchImpl(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    return true;
  } catch (error) {
    logger.warn("expo_push_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Category keys a user can mute in their pushPrefs doc. Derived from the audited
 * sendPush call sites (matchLifecycle, finals, fixtures, scheduled, seasonAdmin):
 * every call site passes a data.type, and those types group into these buckets —
 * the two finals types share one category so users get a single "Finals" switch.
 * Must stay in sync with PUSH_CATEGORIES in mobile/src/lib/league/pushPrefs.ts.
 */
export const PUSH_CATEGORY_KEYS = [
  "results",
  "confirmations",
  "disputes",
  "fixtures",
  "finals",
  "general",
] as const;

export type PushCategory = (typeof PUSH_CATEGORY_KEYS)[number];

/** Every audited data.type → its mute category; anything else falls back to "general". */
const TYPE_TO_CATEGORY: Readonly<Record<string, PushCategory>> = {
  match_confirmed: "results",
  match_pending: "confirmations",
  match_disputed: "disputes",
  fixture_created: "fixtures",
  finals_set: "finals",
  finals_tie_set: "finals",
};

/** Which mute category a push belongs to. A missing/unknown type lands in "general"
 * so a future call site that forgets data.type is still muteable rather than
 * permanently exempt from preferences. */
export function pushCategory(type: string | undefined): PushCategory {
  if (type === undefined) return "general";
  return TYPE_TO_CATEGORY[type] ?? "general";
}

/**
 * True when the user's pushPrefs `muted` list silences this push's category.
 * Defensive on purpose: `muted` only counts if it is an array and the match is a
 * plain string, so a malformed doc (object, scalar, junk entries) can never silence
 * a push — preferences fail toward delivering, never toward dropping.
 */
export function isMuted(muted: unknown, type: string | undefined): boolean {
  if (!Array.isArray(muted)) return false;
  const category = pushCategory(type);
  return muted.some((entry) => typeof entry === "string" && entry === category);
}

export async function sendPush(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  // Resolve lazily: this module is imported at the top of index.ts, before
  // initializeApp() runs, so calling getFirestore() at module load would crash.
  const db = getFirestore();
  // Per-category mute check before touching tokens. Deliver-by-default in BOTH the
  // missing-doc and the read-failure case: a transient prefs-read error must degrade to
  // "send it", never fail an action that already committed (a confirm, a resolve...).
  try {
    const prefs = await db.doc(`pushPrefs/${uid}`).get();
    if (isMuted(prefs.get("muted"), data?.type)) return;
  } catch (error) {
    logger.warn("push_prefs_read_failed_delivering_anyway", {
      uid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const tokens = await db.collection(`deviceTokens/${uid}/tokens`).get();
  const messages = buildPushMessages(
    tokens.docs.map((snap) => snap.get("expoPushToken")),
    title,
    body,
    data,
  );
  await deliverPushMessages(messages);
}
