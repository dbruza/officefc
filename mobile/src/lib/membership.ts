/** leagues/{LEAGUE_ID}/members/{uid} — league membership + role. Writes are server-only. */
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { LEAGUE_ID } from "./constants";
import type { Role } from "./profiles";

export interface Membership {
  uid: string;
  role: Role;
}

export async function getMembership(uid: string): Promise<Membership | null> {
  const snap = await getDoc(doc(db, "leagues", LEAGUE_ID, "members", uid));
  return snap.exists() ? ({ uid, role: snap.data().role as Role }) : null;
}

export interface RedeemResult {
  ok: boolean;
  role: Role;
  /** True when admitted via the admin allowlist rather than a code. */
  bootstrapped?: boolean;
}

/**
 * Redeem an invite code to join the league. Allowlisted admins may pass an empty code
 * (the function admits + promotes them). All validation/consumption is server-side.
 */
export async function redeemInvite(code: string): Promise<RedeemResult> {
  const callable = httpsCallable<{ code: string }, RedeemResult>(functions, "redeemInvite");
  const res = await callable({ code: code.trim() });
  return res.data;
}

export interface CreateInviteResult {
  code: string;
  role: Role;
  expiresAt: number | null;
}

/** Admin-only: mint a new invite code. */
export async function createInvite(role: Role = "member", ttlDays = 14): Promise<CreateInviteResult> {
  const callable = httpsCallable<{ role: Role; ttlDays: number }, CreateInviteResult>(
    functions,
    "createInvite",
  );
  const res = await callable({ role, ttlDays });
  return res.data;
}
