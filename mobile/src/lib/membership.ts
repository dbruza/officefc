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
  return snap.exists() ? { uid, role: snap.data().role as Role } : null;
}

export interface RedeemResult {
  ok: boolean;
  role: Role;
  /** True when admitted via the admin allowlist rather than a code. */
  bootstrapped?: boolean;
}

/**
 * Redeem a season join code to join the league. Allowlisted admins may pass an empty code
 * (the function admits + promotes them). The code is the current season's shared, multi-use
 * code; all validation is server-side.
 */
export async function redeemInvite(code: string): Promise<RedeemResult> {
  const callable = httpsCallable<{ code: string }, RedeemResult>(functions, "redeemInvite");
  const res = await callable({ code: code.trim() });
  return res.data;
}

export interface SeasonJoinCodeResult {
  seasonId: string;
  code: string;
}

/** Admin-only: get (or generate) the shared join code for a season (defaults to the active one). */
export async function getSeasonJoinCode(seasonId?: string): Promise<SeasonJoinCodeResult> {
  const callable = httpsCallable<{ seasonId?: string }, SeasonJoinCodeResult>(
    functions,
    "getSeasonJoinCode",
  );
  const res = await callable(seasonId ? { seasonId } : {});
  return res.data;
}

/** Admin-only: rotate a season's join code; the previous code stops working immediately. */
export async function rotateSeasonJoinCode(seasonId: string): Promise<SeasonJoinCodeResult> {
  const callable = httpsCallable<{ seasonId: string }, SeasonJoinCodeResult>(
    functions,
    "rotateSeasonJoinCode",
  );
  const res = await callable({ seasonId });
  return res.data;
}
