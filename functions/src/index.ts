/**
 * OfficeFC Cloud Functions — trusted writes that clients can't make directly.
 *
 * M1: membership lifecycle.
 *   - redeemInvite: join the league via a code (or admin-allowlist bootstrap).
 *   - createInvite: admin-only; mint a shareable invite code.
 * (ELO recalc + match confirmation arrive in M2.)
 */
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID, isAllowlistedAdmin } from "./config";

initializeApp();
const db = getFirestore();

type Role = "admin" | "member";

const memberRef = (uid: string) => db.doc(`leagues/${LEAGUE_ID}/members/${uid}`);
const leagueRef = () => db.doc(`leagues/${LEAGUE_ID}`);
const inviteRef = (code: string) => db.doc(`invites/${code}`);

function requireAuth(req: CallableRequest): { uid: string; email?: string } {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return { uid: req.auth.uid, email: req.auth.token.email };
}

async function assertAdmin(uid: string): Promise<void> {
  const snap = await memberRef(uid).get();
  if (!snap.exists || snap.get("role") !== "admin") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

/** Ensure the singleton league document exists. */
async function ensureLeague(): Promise<void> {
  await leagueRef().set(
    { name: "OfficeFC", createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Join the league.
 * - Already a member → idempotent no-op (returns existing role).
 * - Allowlisted admin → seed league + admin membership, no code needed.
 * - Otherwise → validate & atomically consume the invite code.
 */
export const redeemInvite = onCall(async (req) => {
  const { uid, email } = requireAuth(req);

  const existing = await memberRef(uid).get();
  if (existing.exists) {
    return { ok: true, role: existing.get("role") as Role };
  }

  if (isAllowlistedAdmin(email)) {
    await ensureLeague();
    await memberRef(uid).set({
      role: "admin",
      joinedAt: FieldValue.serverTimestamp(),
      bootstrap: true,
    });
    return { ok: true, role: "admin" as Role, bootstrapped: true };
  }

  const code = String(req.data?.code ?? "").trim().toUpperCase();
  if (!code) throw new HttpsError("failed-precondition", "An invite code is required.");

  const role = await db.runTransaction(async (tx) => {
    const inv = await tx.get(inviteRef(code));
    if (!inv.exists) throw new HttpsError("not-found", "Invite code not found.");
    if (inv.get("usedBy")) throw new HttpsError("failed-precondition", "That code was already used.");
    const expiresAt = inv.get("expiresAt") as Timestamp | undefined;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "That code has expired.");
    }
    const grantedRole = (inv.get("role") as Role) ?? "member";
    tx.set(memberRef(uid), {
      role: grantedRole,
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: inv.get("createdBy") ?? null,
      viaCode: code,
    });
    tx.update(inviteRef(code), { usedBy: uid, usedAt: FieldValue.serverTimestamp() });
    return grantedRole;
  });

  return { ok: true, role };
});

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
function randomCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `OFC-${s}`;
}

/** Admin-only: mint a shareable invite code. */
export const createInvite = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const role: Role = req.data?.role === "admin" ? "admin" : "member";
  const ttlDays = Math.min(Math.max(Number(req.data?.ttlDays) || 14, 1), 90);
  const expiresMillis = Date.now() + ttlDays * 86_400_000;

  // Find an unused code (collisions are astronomically unlikely, but be safe).
  let code = randomCode();
  for (let i = 0; i < 5 && (await inviteRef(code).get()).exists; i++) code = randomCode();

  await inviteRef(code).set({
    role,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresMillis),
    usedBy: null,
  });

  return { code, role, expiresAt: expiresMillis };
});
