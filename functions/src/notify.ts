import { createHash, randomUUID } from "node:crypto";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { instrumentBackground } from "./sentry";
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
    const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8000),
    });
    // Drain the body so the connection can be reused; the same abort signal covers it.
    await response.arrayBuffer?.();
    return response.ok;
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

async function sendPushNow(
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
  if (messages.length && !(await deliverPushMessages(messages)))
    throw new Error("Push delivery failed");
}

/** Enqueue before returning. Deterministic ids make confirmation retries idempotent. */
export async function sendPush(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const id = createHash("sha256")
    .update(JSON.stringify([uid, title, body, Object.entries(data).sort()]))
    .digest("hex");
  try {
    await getFirestore()
      .doc(`notificationOutbox/${id}`)
      .create({
        uid,
        title,
        body,
        data,
        status: "pending",
        attempts: 0,
        nextAttemptAt: Timestamp.now(),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
      });
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
  }
}
async function deliverQueuedPush(id: string): Promise<void> {
  const db = getFirestore(),
    ref = db.doc(`notificationOutbox/${id}`),
    token = randomUUID();
  const work = await db.runTransaction(async (tx) => {
    const row = await tx.get(ref),
      data = row.data();
    if (
      !data ||
      data.status === "sent" ||
      data.status === "failed" ||
      (data.nextAttemptAt as Timestamp).toMillis() > Date.now()
    )
      return null;
    tx.update(ref, {
      status: "sending",
      token,
      attempts: FieldValue.increment(1),
      nextAttemptAt: Timestamp.fromMillis(Date.now() + 60000),
    });
    return data;
  });
  if (!work) return;
  let delivered = false;
  try {
    await sendPushNow(work.uid, work.title, work.body, work.data);
    delivered = true;
  } catch (error) {
    logger.warn("push_retry", { id, error: String(error) });
  }
  await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    if (row.get("token") !== token) return;
    const attempts = Number(row.get("attempts"));
    tx.update(ref, {
      status: delivered ? "sent" : attempts >= 5 ? "failed" : "pending",
      nextAttemptAt: Timestamp.fromMillis(Date.now() + Math.min(3600000, 60000 * 2 ** attempts)),
      ...(delivered ? { sentAt: FieldValue.serverTimestamp() } : {}),
    });
  });
}
export const deliverNotification = onDocumentCreated(
  {
    region: "australia-southeast1",
    document: "notificationOutbox/{id}",
    timeoutSeconds: 60,
    retry: true,
  },
  instrumentBackground("deliverNotification", async (event) => {
    await deliverQueuedPush(event.params.id);
  }),
);
export const retryNotifications = onSchedule(
  {
    region: "australia-southeast1",
    schedule: "* * * * *",
    timeoutSeconds: 120,
    maxInstances: 1,
    concurrency: 1,
  },
  instrumentBackground("retryNotifications", async () => {
    const due = await getFirestore()
      .collection("notificationOutbox")
      .where("status", "in", ["pending", "sending"])
      .where("nextAttemptAt", "<=", Timestamp.now())
      .orderBy("nextAttemptAt")
      .limit(50)
      .get();
    for (let i = 0; i < due.docs.length; i += 5)
      await Promise.all(due.docs.slice(i, i + 5).map((row) => deliverQueuedPush(row.id)));
  }),
);

export async function enqueuePushesTx(
  tx: Transaction,
  messages: Array<{
    uid: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }>,
): Promise<void> {
  const rows = messages.map((message) => {
    const { uid, title, body, data } = message;
    const id = createHash("sha256")
      .update(JSON.stringify([uid, title, body, Object.entries(data).sort()]))
      .digest("hex");
    return { ref: getFirestore().doc(`notificationOutbox/${id}`), message };
  });
  const existing = rows.length ? await tx.getAll(...rows.map((row) => row.ref)) : [];
  rows.forEach((row, index) => {
    if (!existing[index].exists)
      tx.create(row.ref, {
        ...row.message,
        status: "pending",
        attempts: 0,
        nextAttemptAt: Timestamp.now(),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
      });
  });
}
