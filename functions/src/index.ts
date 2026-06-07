/**
 * OfficeFC Cloud Functions — trusted writes that clients can't make directly.
 *
 * M1: membership lifecycle.
 *   - redeemInvite: join the league via a code (or admin-allowlist bootstrap).
 *   - createInvite: admin-only; mint a shareable invite code.
 * M2: match lifecycle.
 *   - ensureLeagueData: admin-only active-season + team seed.
 *   - confirmMatch/disputeMatch: opponent-only pending-match resolution.
 *   - recalculation: deterministic season ELO + standings + history materialization.
 */
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID, isAllowlistedAdmin } from "./config";
import { calculateSeason, type SeasonMatchInput } from "./elo";

initializeApp();
const db = getFirestore();

type Role = "admin" | "member";

const memberRef = (uid: string) => db.doc(`leagues/${LEAGUE_ID}/members/${uid}`);
const leagueRef = () => db.doc(`leagues/${LEAGUE_ID}`);
const inviteRef = (code: string) => db.doc(`invites/${code}`);
const seasonRef = (seasonId: string) => db.doc(`seasons/${seasonId}`);

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

/** Ensure the singleton league, one active season, and the default team catalogue exist. */
async function ensureLeagueData(): Promise<{ seasonId: string }> {
  await leagueRef().set(
    { name: "OfficeFC", createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
  let activeSeasonId = active.docs[0]?.id;
  if (!activeSeasonId) {
    activeSeasonId = DEFAULT_SEASON.id;
    await seasonRef(activeSeasonId).set({
      name: DEFAULT_SEASON.name,
      year: DEFAULT_SEASON.year,
      start: DEFAULT_SEASON.start,
      end: DEFAULT_SEASON.end,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
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
 * - Otherwise → validate & atomically consume the invite code.
 */
export const redeemInvite = onCall(async (req) => {
  const { uid, email } = requireAuth(req);

  const existing = await memberRef(uid).get();
  if (existing.exists) {
    return { ok: true, role: existing.get("role") as Role };
  }

  if (isAllowlistedAdmin(email)) {
    await ensureLeagueData();
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

/** Admin-only idempotent seed for local/dev environments and fresh deployments. */
export const ensureLeagueSetup = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const { seasonId } = await ensureLeagueData();
  return { ok: true, seasonId, teamCount: DEFAULT_TEAMS.length };
});

function dateMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function recalcSeasonElo(seasonId: string): Promise<void> {
  const [season, members, matchSnaps, oldStandings, oldHistory] = await Promise.all([
    seasonRef(seasonId).get(),
    leagueRef().collection("members").get(),
    db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .where("status", "==", "confirmed")
      .get(),
    seasonRef(seasonId).collection("standings").get(),
    seasonRef(seasonId).collection("eloHistory").get(),
  ]);
  if (!season.exists) throw new HttpsError("not-found", "Season not found.");

  const matches: SeasonMatchInput[] = matchSnaps.docs.map((snap) => {
    const data = snap.data();
    return {
      id: snap.id,
      aId: String(data.aId),
      bId: String(data.bId),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
    };
  });
  const startMillis = dateMillis(season.get("start"));
  const result = calculateSeason(
    matches,
    members.docs.map((snap) => snap.id),
    startMillis,
  );

  const writer = db.bulkWriter();
  const standingIds = new Set(result.standings.map((standing) => standing.uid));
  const historyIds = new Set(Object.keys(result.history));
  for (const snap of oldStandings.docs) {
    if (!standingIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHistory.docs) {
    if (!historyIds.has(snap.id)) writer.delete(snap.ref);
  }

  for (const match of result.matches) {
    writer.set(
      db.doc(`matches/${match.id}`),
      {
        aEloBefore: match.aEloBefore,
        aEloAfter: match.aEloAfter,
        aDelta: match.aDelta,
        bEloBefore: match.bEloBefore,
        bEloAfter: match.bEloAfter,
        bDelta: match.bDelta,
        recalculatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  for (const standing of result.standings) {
    writer.set(seasonRef(seasonId).collection("standings").doc(standing.uid), {
      ...standing,
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const [uid, points] of Object.entries(result.history)) {
    writer.set(seasonRef(seasonId).collection("eloHistory").doc(uid), {
      points: points.map((point) => ({
        matchId: point.matchId,
        date: Timestamp.fromMillis(point.dateMillis),
        rating: point.rating,
      })),
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}

async function sendPush(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const tokens = await db.collection(`deviceTokens/${uid}/tokens`).get();
  const messages = tokens.docs
    .map((snap) => snap.get("expoPushToken"))
    .filter(
      (token): token is string =>
        typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)\[/.test(token),
    )
    .map((to) => ({ to, sound: "default", title, body, data }));
  if (messages.length === 0) return;

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.warn("Expo push delivery failed", error);
  }
}

/** Only the named opponent can confirm a pending match. */
export const confirmMatch = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const ref = db.doc(`matches/${matchId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    const participant = uid === data.aId || uid === data.bId;
    if (!participant || uid === data.submittedBy) {
      throw new HttpsError("permission-denied", "Only the named opponent can confirm.");
    }
    if (data.status !== "pending_confirmation") {
      throw new HttpsError("failed-precondition", "This match is no longer pending.");
    }
    tx.update(ref, {
      status: "confirmed",
      confirmedBy: uid,
      confirmedAt: FieldValue.serverTimestamp(),
    });
    return {
      seasonId: String(data.seasonId),
      submittedBy: String(data.submittedBy),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
    };
  });

  await recalcSeasonElo(result.seasonId);
  await sendPush(
    result.submittedBy,
    "Match confirmed",
    `Your ${result.aGoals}-${result.bGoals} result is now in the table.`,
    { type: "match_confirmed", matchId },
  );
  return { ok: true };
});

/** The named opponent may dispute a pending match; disputed matches never affect ELO. */
export const disputeMatch = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const matchId = String(req.data?.matchId ?? "").trim();
  const reason = String(req.data?.reason ?? "").trim().slice(0, 240);
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const ref = db.doc(`matches/${matchId}`);
  const submittedBy = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    const participant = uid === data.aId || uid === data.bId;
    if (!participant || uid === data.submittedBy) {
      throw new HttpsError("permission-denied", "Only the named opponent can dispute.");
    }
    if (data.status !== "pending_confirmation") {
      throw new HttpsError("failed-precondition", "This match is no longer pending.");
    }
    tx.update(ref, {
      status: "disputed",
      disputedBy: uid,
      disputeReason: reason || null,
      disputedAt: FieldValue.serverTimestamp(),
    });
    return String(data.submittedBy);
  });

  await sendPush(submittedBy, "Match disputed", "Your opponent flagged a submitted result.", {
    type: "match_disputed",
    matchId,
  });
  return { ok: true };
});

/** Notify the opponent when any valid client creates a pending match. */
export const notifyMatchSubmitted = onDocumentCreated("matches/{matchId}", async (event) => {
  const data = event.data?.data();
  if (!data || data.status !== "pending_confirmation") return;
  const opponentId = data.submittedBy === data.aId ? data.bId : data.aId;
  if (typeof opponentId !== "string") return;
  await sendPush(
    opponentId,
    "Result needs your nod",
    `Confirm or dispute the ${data.aGoals}-${data.bGoals} score.`,
    { type: "match_pending", matchId: event.params.matchId },
  );
});
