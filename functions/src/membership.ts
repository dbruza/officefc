import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { loggedOnCall } from "./logging";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID, isAllowlistedAdmin } from "./config";
import { requireAuth, assertAdmin } from "./auth";
import {
  findSeasonIdByJoinCode,
  generateUniqueJoinCode,
  readSeasonJoinCode,
  writeSeasonJoinCode,
} from "./utils";
import { seasonJoinRejection } from "./membershipRules";
import { seedTeamCatalogue } from "./teams";
import { isActiveMember } from "./members";

type Role = "admin" | "member";

/** Placeholder season for a league with none active: three months from today. Admins
 * rename it or replace it from Admin → Seasons. */
function placeholderSeason(now = new Date()) {
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 3);
  return {
    id: `season-${now.getTime()}`,
    name: "New season",
    year: now.getUTCFullYear(),
    start: Timestamp.fromDate(now),
    end: Timestamp.fromDate(end),
  };
}

/** Ensure the singleton league, one active season, and the team catalogue exist. */
async function ensureLeagueData(): Promise<{ seasonId: string; teamCount: number }> {
  const db = getFirestore();
  await db
    .doc(`leagues/${LEAGUE_ID}`)
    .set({ name: "OfficeFC", createdAt: FieldValue.serverTimestamp() }, { merge: true });

  const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
  let activeSeasonId = active.docs[0]?.id;
  if (!activeSeasonId) {
    const season = placeholderSeason();
    activeSeasonId = season.id;
    await db.doc(`seasons/${activeSeasonId}`).set({
      name: season.name,
      year: season.year,
      start: season.start,
      end: season.end,
      active: true,
      finalized: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    await writeSeasonJoinCode(activeSeasonId, await generateUniqueJoinCode());
  } else if (!(await readSeasonJoinCode(activeSeasonId))) {
    await writeSeasonJoinCode(activeSeasonId, await generateUniqueJoinCode());
  }

  const { active: activeTeamCount } = await seedTeamCatalogue();
  return { seasonId: activeSeasonId, teamCount: activeTeamCount };
}

/**
 * Joining is keyed on the caller's email (the admin allowlist) and costs an attacker
 * nothing per account, so it requires an email Firebase has verified.
 */
function hasVerifiedEmail(req: CallableRequest): boolean {
  return req.auth?.token.email_verified === true;
}

/** Join codes are short; wrong guesses per account are capped so they can't be enumerated. */
const JOIN_FAILURE_LIMIT = 10;
const JOIN_FAILURE_WINDOW_MS = 60 * 60 * 1000;

async function assertJoinAttemptsLeft(uid: string): Promise<void> {
  const snap = await getFirestore().doc(`joinAttempts/${uid}`).get();
  const windowStart = snap.get("windowStart")?.toMillis?.() ?? 0;
  if (
    Date.now() - windowStart < JOIN_FAILURE_WINDOW_MS &&
    Number(snap.get("failures") ?? 0) >= JOIN_FAILURE_LIMIT
  )
    throw new HttpsError(
      "resource-exhausted",
      "Too many incorrect join codes. Try again in an hour, or ask your admin for an invite link.",
    );
}

async function recordJoinFailure(uid: string): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`joinAttempts/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const windowStart = snap.get("windowStart")?.toMillis?.() ?? 0;
    if (now - windowStart >= JOIN_FAILURE_WINDOW_MS)
      tx.set(ref, { windowStart: Timestamp.fromMillis(now), failures: 1 });
    else tx.update(ref, { failures: FieldValue.increment(1) });
  });
}

/**
 * What the join screen should offer: admin setup when the caller's own verified email is
 * on the allowlist. It answers only about the caller, so the allowlist never ships in the
 * app.
 */
export const getJoinOptions = loggedOnCall("getJoinOptions", { cors: true }, async (req) => {
  const { email } = requireAuth(req);
  return { adminSetup: hasVerifiedEmail(req) && isAllowlistedAdmin(email) };
});

/**
 * Join the league.
 * - Already a member → idempotent no-op (returns existing role).
 * - Allowlisted admin → seed league + admin membership, no code needed.
 * - Otherwise → validate the season join code (multi-use, permanent membership).
 */
export const redeemInvite = loggedOnCall("redeemInvite", { cors: true }, async (req) => {
  const { uid, email } = requireAuth(req);
  const db = getFirestore();
  const memberRef = db.doc(`leagues/${LEAGUE_ID}/members/${uid}`);

  const existing = await memberRef.get();
  if (existing.exists) {
    // A removed member keeps their doc, so a join code can't quietly re-admit them.
    if (!isActiveMember(existing))
      throw new HttpsError(
        "permission-denied",
        "You've been removed from this league. Contact your league admin if you think this is a mistake.",
      );
    return { ok: true, role: existing.get("role") as Role };
  }

  if (!hasVerifiedEmail(req))
    throw new HttpsError("failed-precondition", "Verify your email address before joining.");

  if (isAllowlistedAdmin(email)) {
    await ensureLeagueData();
    await memberRef.set({
      role: "admin",
      joinedAt: FieldValue.serverTimestamp(),
      bootstrap: true,
    });
    return { ok: true, role: "admin" as Role, bootstrapped: true };
  }

  const code = String(req.data?.code ?? "")
    .trim()
    .toUpperCase();
  if (!code) throw new HttpsError("failed-precondition", "A season join code is required.");

  await assertJoinAttemptsLeft(uid);
  const seasonId = await findSeasonIdByJoinCode(code);
  if (!seasonId) {
    await recordJoinFailure(uid);
    throw new HttpsError("not-found", "Join code not found.");
  }
  const seasonDoc = await db.doc(`seasons/${seasonId}`).get();
  if (!seasonDoc.exists) throw new HttpsError("not-found", "Join code not found.");
  const rejection = seasonJoinRejection({
    active: seasonDoc.get("active"),
    finalized: seasonDoc.get("finalized"),
  });
  if (rejection === "inactive")
    throw new HttpsError("failed-precondition", "That season is no longer active.");
  if (rejection === "finalized")
    throw new HttpsError("failed-precondition", "That season has been finalized.");

  await memberRef.set({
    role: "member" as Role,
    joinedAt: FieldValue.serverTimestamp(),
    // Not the code itself: member docs are readable by every member, and the code is not.
    viaSeason: seasonId,
  });

  return { ok: true, role: "member" as Role };
});

/** Admin-only idempotent seed for local/dev environments and fresh deployments. */
export const ensureLeagueSetup = loggedOnCall("ensureLeagueSetup", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const { seasonId, teamCount } = await ensureLeagueData();
  return { ok: true, seasonId, teamCount };
});
