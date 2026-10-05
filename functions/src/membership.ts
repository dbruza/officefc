import { HttpsError } from "firebase-functions/v2/https";
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

const DEFAULT_SEASON = {
  id: "summer-2026",
  name: "Summer Showdown",
  year: 2026,
  start: Timestamp.fromDate(new Date("2026-04-01T00:00:00.000Z")),
  end: Timestamp.fromDate(new Date("2026-06-30T23:59:59.999Z")),
};

/** Ensure the singleton league, one active season, and the team catalogue exist. */
async function ensureLeagueData(): Promise<{ seasonId: string; teamCount: number }> {
  const db = getFirestore();
  await db
    .doc(`leagues/${LEAGUE_ID}`)
    .set({ name: "OfficeFC", createdAt: FieldValue.serverTimestamp() }, { merge: true });

  const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
  let activeSeasonId = active.docs[0]?.id;
  if (!activeSeasonId) {
    activeSeasonId = DEFAULT_SEASON.id;
    await db.doc(`seasons/${activeSeasonId}`).set({
      name: DEFAULT_SEASON.name,
      year: DEFAULT_SEASON.year,
      start: DEFAULT_SEASON.start,
      end: DEFAULT_SEASON.end,
      active: true,
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

  const seasonId = await findSeasonIdByJoinCode(code);
  if (!seasonId) throw new HttpsError("not-found", "Join code not found.");
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
    viaSeason: seasonId,
    viaCode: code,
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
