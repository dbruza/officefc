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
import { getStorage } from "firebase-admin/storage";
import { LEAGUE_ID, isAllowlistedAdmin } from "./config";
import { calculateSeason, type SeasonMatchInput } from "./elo";
import { deriveLeagueStats, type ConfirmedMatchInput } from "./stats";
import { sendPush } from "./notify";

initializeApp();
const db = getFirestore();
const storage = getStorage();

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
  const oldMove = new Map<string, number>();
  for (const snap of oldStandings.docs) {
    const m = snap.get("move");
    if (typeof m === "number") oldMove.set(snap.id, m);
  }
  for (const standing of result.standings) {
    writer.set(seasonRef(seasonId).collection("standings").doc(standing.uid), {
      ...standing,
      move: oldMove.get(standing.uid) ?? standing.move,
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

async function recalcLeagueStats(): Promise<void> {
  const [members, matchSnaps, oldPlayerStats, oldHeadToHead] = await Promise.all([
    leagueRef().collection("members").get(),
    db.collection("matches").where("status", "==", "confirmed").get(),
    db.collection("playerStats").get(),
    db.collection("h2h").get(),
  ]);
  const matches: ConfirmedMatchInput[] = matchSnaps.docs.map((snap) => {
    const data = snap.data();
    return {
      id: snap.id,
      seasonId: String(data.seasonId),
      aId: String(data.aId),
      bId: String(data.bId),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      aDelta: Number(data.aDelta ?? 0),
      bDelta: Number(data.bDelta ?? 0),
      dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
    };
  });
  const result = deriveLeagueStats(
    matches,
    members.docs.map((snap) => snap.id),
  );
  const writer = db.bulkWriter();
  const playerIds = new Set(result.players.map((player) => player.uid));
  const pairKeys = new Set(result.headToHead.map((pair) => pair.pairKey));

  for (const snap of oldPlayerStats.docs) {
    if (!playerIds.has(snap.id)) writer.delete(snap.ref);
  }
  for (const snap of oldHeadToHead.docs) {
    if (!pairKeys.has(snap.id)) writer.delete(snap.ref);
  }
  for (const player of result.players) {
    writer.set(db.doc(`playerStats/${player.uid}`), {
      ...player,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const pair of result.headToHead) {
    writer.set(db.doc(`h2h/${pair.pairKey}`), {
      ...pair,
      meetings: pair.meetings.map((meeting) => ({
        ...meeting,
        date: Timestamp.fromMillis(meeting.dateMillis),
      })),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}

/** Admin-only migration/backfill for the read models introduced in M2/M3. */
export const rebuildLeagueReadModels = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const confirmed = await db.collection("matches").where("status", "==", "confirmed").get();
  const seasonIds = [
    ...new Set(confirmed.docs.map((snap) => String(snap.get("seasonId"))).filter(Boolean)),
  ];
  for (const seasonId of seasonIds) await recalcSeasonElo(seasonId);
  await recalcLeagueStats();
  return { ok: true, seasonCount: seasonIds.length, matchCount: confirmed.size };
});

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
  await recalcLeagueStats();
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

/** Delete a match photo from storage and clear the reference. Owner only. */
export const deleteMatchPhoto = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "matchId is required.");

  const ref = db.doc(`matches/${matchId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    if (data.submittedBy !== uid) throw new HttpsError("permission-denied", "Only the submitter can delete their photo.");
    const photoPath = String(data.photoPath ?? "");
    if (!photoPath) throw new HttpsError("not-found", "No photo stored for this match.");

    const bucket = storage.bucket();
    const [exists] = await bucket.file(photoPath).exists();
    if (exists) await bucket.file(photoPath).delete();

    tx.update(ref, { photoPath: FieldValue.delete(), photoDeletedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true, matchId };
});

// --- M4B — AI extraction ---
export { extractMatchStats } from "./extract/extractMatchStats";
export { abandonMatchDraft } from "./extract/abandonMatchDraft";
export { getMatchPhotoUrl } from "./extract/getMatchPhotoUrl";
export { submitAiAssistedMatch } from "./extract/submitAiAssistedMatch";

// --- M5 — Season lifecycle & admin ---
export {
  finalizeSeason,
  createSeason,
  activateSeason,
  manageTeam,
  resolveMatch,
  listSeasons,
} from "./seasonAdmin";

// --- M5 — Scheduled jobs ---
export { weeklySnapshot, sendReminders, cleanupAbandonedDrafts } from "./scheduled";
