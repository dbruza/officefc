import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { LEAGUE_ID } from "./config";
import { isActiveMember } from "./members";

/** Require an authenticated caller; returns their uid and email (if the token carries one). */
export function requireAuth(req: CallableRequest): { uid: string; email?: string } {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return { uid: req.auth.uid, email: req.auth.token.email };
}

/** Throw unless the uid is an admin member of the league. */
export async function assertAdmin(uid: string): Promise<void> {
  const snap = await getFirestore().doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!isActiveMember(snap) || snap.get("role") !== "admin") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

/** Throw unless the uid is an active member of the league (removed members are locked out). */
export async function assertMember(uid: string): Promise<void> {
  const snap = await getFirestore().doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!isActiveMember(snap)) throw new HttpsError("permission-denied", "League members only.");
}
