import { getFirestore, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { randomCode } from "./config";
import type { SeasonMatchInput } from "./elo";

/** Coerce a Firestore Timestamp or ISO date string to epoch millis; unknown shapes → 0. */
export function dateMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Map a match doc to the season-calculation input; date falls back to confirmedAt → createdAt. */
export function seasonMatchInputFromDoc(snap: QueryDocumentSnapshot): SeasonMatchInput {
  const data = snap.data();
  return {
    id: snap.id,
    aId: String(data.aId),
    bId: String(data.bId),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    aShotsOnTarget: data.aShotsOnTarget != null ? Number(data.aShotsOnTarget) : null,
    bShotsOnTarget: data.bShotsOnTarget != null ? Number(data.bShotsOnTarget) : null,
    aPossession: data.aPossession != null ? Number(data.aPossession) : null,
    bPossession: data.bPossession != null ? Number(data.bPossession) : null,
    dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
  };
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
