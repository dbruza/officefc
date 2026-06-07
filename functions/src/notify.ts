import { getFirestore } from "firebase-admin/firestore";

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
  const messages = tokens.docs
    .map((snap) => snap.get("expoPushToken"))
    .filter(
      (token): token is string =>
        typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)\[/.test(token),
    )
    .map((to) => ({ to, sound: "default", title, body, data }));
  if (messages.length === 0) return;

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.warn("Expo push delivery failed", error);
  }
}
