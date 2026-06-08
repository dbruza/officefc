import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomCode } from "./config";

/** Coerce a Firestore Timestamp or ISO date string to epoch millis; unknown shapes → 0. */
export function dateMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** A join code no other season is using. Throws if 10 random tries all collide. */
export async function generateUniqueJoinCode(): Promise<string> {
  const db = getFirestore();
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const existing = await db.collection("seasons").where("joinCode", "==", code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error("Failed to generate a unique join code after 10 attempts.");
}
