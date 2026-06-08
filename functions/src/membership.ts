import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID, isAllowlistedAdmin } from "./config";
import { requireAuth, assertAdmin } from "./auth";
import { generateUniqueJoinCode } from "./utils";

type Role = "admin" | "member";

const DEFAULT_SEASON = {
  id: "summer-2026",
  name: "Summer Showdown",
  year: 2026,
  start: Timestamp.fromDate(new Date("2026-04-01T00:00:00.000Z")),
  end: Timestamp.fromDate(new Date("2026-06-30T23:59:59.999Z")),
};

const DEFAULT_TEAMS = [
  ["crimson-albion", "Crimson Albion"],
  ["northgate-united", "Northgate United"],
  ["royal-vega", "Royal Vega"],
  ["azzurri-select", "Azzurri Select"],
  ["bavaria-xi", "Bavaria XI"],
  ["la-costa-cf", "La Costa CF"],
  ["harbour-city", "Harbour City"],
  ["verde-nacional", "Verde Nacional"],
  ["iron-foundry", "Iron Foundry"],
  ["capital-athletic", "Capital Athletic"],
  ["sierra-rovers", "Sierra Rovers"],
  ["black-forest-sv", "Black Forest SV"],
  ["oranje-stars", "Oranje Stars"],
  ["maple-wanderers", "Maple Wanderers"],
  ["delta-galacticos", "Delta Galacticos"],
  ["phoenix-borough", "Phoenix Borough"],
] as const;

/** Ensure the singleton league, one active season, and the default team catalogue exist. */
async function ensureLeagueData(): Promise<{ seasonId: string }> {
  const db = getFirestore();
  await db
    .doc(`leagues/${LEAGUE_ID}`)
    .set({ name: "OfficeFC", createdAt: FieldValue.serverTimestamp() }, { merge: true });

  const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
  let activeSeasonId = active.docs[0]?.id;
  if (!activeSeasonId) {
    activeSeasonId = DEFAULT_SEASON.id;
    const joinCode = await generateUniqueJoinCode();
    await db.doc(`seasons/${activeSeasonId}`).set({
      name: DEFAULT_SEASON.name,
      year: DEFAULT_SEASON.year,
      start: DEFAULT_SEASON.start,
      end: DEFAULT_SEASON.end,
      active: true,
      joinCode,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    const seasonSnap = await db.doc(`seasons/${activeSeasonId}`).get();
    if (!seasonSnap.get("joinCode")) {
      const joinCode = await generateUniqueJoinCode();
      await db.doc(`seasons/${activeSeasonId}`).update({ joinCode });
    }
  }

  const batch = db.batch();
  for (const [id, name] of DEFAULT_TEAMS) {
    batch.set(
      db.doc(`teams/${id}`),
      { name, active: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
  return { seasonId: activeSeasonId };
}

/**
 * Join the league.
 * - Already a member → idempotent no-op (returns existing role).
 * - Allowlisted admin → seed league + admin membership, no code needed.
 * - Otherwise → validate the season join code (multi-use, permanent membership).
 */
export const redeemInvite = onCall({ cors: true }, async (req) => {
  const { uid, email } = requireAuth(req);
  const db = getFirestore();
  const memberRef = db.doc(`leagues/${LEAGUE_ID}/members/${uid}`);

  const existing = await memberRef.get();
  if (existing.exists) {
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

  const seasonSnaps = await db.collection("seasons").where("joinCode", "==", code).limit(1).get();
  if (seasonSnaps.empty) throw new HttpsError("not-found", "Join code not found.");
  const seasonDoc = seasonSnaps.docs[0];
  if (!seasonDoc.get("active"))
    throw new HttpsError("failed-precondition", "That season is no longer active.");
  if (seasonDoc.get("finalized"))
    throw new HttpsError("failed-precondition", "That season has been finalized.");

  await memberRef.set({
    role: "member" as Role,
    joinedAt: FieldValue.serverTimestamp(),
    viaSeason: seasonDoc.id,
    viaCode: code,
  });

  return { ok: true, role: "member" as Role };
});

/** Admin-only idempotent seed for local/dev environments and fresh deployments. */
export const ensureLeagueSetup = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const { seasonId } = await ensureLeagueData();
  return { ok: true, seasonId, teamCount: DEFAULT_TEAMS.length };
});
