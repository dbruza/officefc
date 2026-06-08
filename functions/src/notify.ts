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
    console.warn("Expo push delivery failed", error);
    return false;
  }
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
  const tokens = await db.collection(`deviceTokens/${uid}/tokens`).get();
  const messages = buildPushMessages(
    tokens.docs.map((snap) => snap.get("expoPushToken")),
    title,
    body,
    data,
  );
  await deliverPushMessages(messages);
}
