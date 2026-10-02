import { invalidateData } from "./dataCache";
/** profiles/{uid} — the player's public identity. */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export type Role = "admin" | "member";

export interface Profile {
  uid: string;
  displayName: string;
  handle: string;
  jersey: number;
  /** Avatar base colour (hex). */
  color: string;
  /** Denormalized for convenience; the authoritative role lives on the membership doc. */
  role?: Role;
}

/** Fields the user supplies during profile setup / edit. */
export type ProfileInput = Pick<Profile, "displayName" | "handle" | "jersey" | "color">;

export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? ({ uid, ...snap.data() } as Profile) : null;
}

/** Create or update the signed-in user's profile (never writes `role` — rules forbid it). */
export async function saveProfile(uid: string, input: ProfileInput): Promise<void> {
  await setDoc(
    doc(db, "profiles", uid),
    {
      displayName: input.displayName.trim(),
      handle: input.handle.trim().replace(/^@/, "").toLowerCase(),
      jersey: input.jersey,
      color: input.color,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  invalidateData();
}
