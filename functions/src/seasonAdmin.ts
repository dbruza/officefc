import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { LEAGUE_ID, randomCode } from "./config";
import { calculateSeason, computePOTM, type SeasonMatchInput, type Standing } from "./elo";
import { deriveLeagueStats, type ConfirmedMatchInput } from "./stats";
import { sendPush } from "./notify";

const db = getFirestore();

async function generateUniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const existing = await db.collection("seasons").where("joinCode", "==", code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error("Failed to generate a unique join code after 10 attempts.");
}

function requireAuth(req: CallableRequest): { uid: string; email?: string } {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return { uid: req.auth.uid, email: req.auth.token.email };
}

async function assertAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!snap.exists || snap.get("role") !== "admin") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

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
    db.doc(`seasons/${seasonId}`).get(),
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
    db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .where("status", "==", "confirmed")
      .get(),
    db.collection(`seasons/${seasonId}/standings`).get(),
    db.collection(`seasons/${seasonId}/eloHistory`).get(),
  ]);
  if (!season.exists) return;

  const matches: SeasonMatchInput[] = matchSnaps.docs.map((snap) => {
    const data = snap.data();
    return {
      id: snap.id,
      aId: String(data.aId),
      bId: String(data.bId),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      aShotsOnTarget: data.aShotsOnTarget != null ? Number(data.aShotsOnTarget) : null,
      bShotsOnTarget: data.bShotsOnTarget != null ? Number(data.bShotsOnTarget) : null,
      aPossession: data.aPossession != null ? Number(data.aPossession) : null,
      bPossession: data.bPossession != null ? Number(data.bPossession) : null,
      dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
    };
  });
  const startMillis = dateMillis(season.get("start"));
  const result = calculateSeason(
    matches,
    members.docs.map((s) => s.id),
    startMillis,
  );

  const writer = db.bulkWriter();
  const standingIds = new Set(result.standings.map((s) => s.uid));
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
    writer.set(db.doc(`seasons/${seasonId}/standings/${standing.uid}`), {
      ...standing,
      move: oldMove.get(standing.uid) ?? standing.move,
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const [uid, points] of Object.entries(result.history)) {
    writer.set(db.doc(`seasons/${seasonId}/eloHistory/${uid}`), {
      points: points.map((p) => ({
        matchId: p.matchId,
        date: Timestamp.fromMillis(p.dateMillis),
        rating: p.rating,
      })),
      recalculatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}

async function recalcLeagueStats(): Promise<void> {
  const [members, matchSnaps, oldPlayerStats, oldHeadToHead] = await Promise.all([
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
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
    members.docs.map((s) => s.id),
  );
  const writer = db.bulkWriter();
  const playerIds = new Set(result.players.map((p) => p.uid));
  const pairKeys = new Set(result.headToHead.map((h) => h.pairKey));
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
      meetings: pair.meetings.map((m) => ({ ...m, date: Timestamp.fromMillis(m.dateMillis) })),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
}

export const finalizeSeason = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  const force = Boolean(req.data?.force);
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");

  const ref = db.doc(`seasons/${seasonId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Season not found.");
  const data = snap.data()!;
  if (data.finalized) throw new HttpsError("failed-precondition", "Already finalized.");

  const endMs = dateMillis(data.end);
  if (endMs > Date.now() && !force) {
    throw new HttpsError(
      "failed-precondition",
      `Season still active until ${new Date(endMs).toISOString().slice(0, 10)}. Use force=true to override.`,
    );
  }

  const confirmed = await db
    .collection("matches")
    .where("seasonId", "==", seasonId)
    .where("status", "==", "confirmed")
    .get();
  if (confirmed.empty)
    throw new HttpsError("failed-precondition", "No confirmed matches in this season.");

  const matchInputs: SeasonMatchInput[] = confirmed.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      aId: String(d.aId),
      bId: String(d.bId),
      aGoals: Number(d.aGoals),
      bGoals: Number(d.bGoals),
      aShotsOnTarget: d.aShotsOnTarget != null ? Number(d.aShotsOnTarget) : null,
      bShotsOnTarget: d.bShotsOnTarget != null ? Number(d.bShotsOnTarget) : null,
      aPossession: d.aPossession != null ? Number(d.aPossession) : null,
      bPossession: d.bPossession != null ? Number(d.bPossession) : null,
      dateMillis: dateMillis(d.date ?? d.confirmedAt ?? d.createdAt),
    };
  });

  const standingsSnap = await db.collection(`seasons/${seasonId}/standings`).get();
  const finalStandings: Standing[] = standingsSnap.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }) as Standing)
    .sort((a, b) => a.rank - b.rank);

  const championId = finalStandings[0]?.uid ?? null;
  const runnerUpId = finalStandings[1]?.uid ?? null;

  const potmResults = computePOTM(matchInputs);

  const writer = db.bulkWriter();
  writer.set(
    ref,
    { active: false, finalized: true, finalizedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  writer.set(db.doc(`seasonResults/${seasonId}`), {
    seasonId,
    championId,
    runnerUpId,
    finalizedAt: FieldValue.serverTimestamp(),
  });
  for (const potm of potmResults) {
    writer.set(db.doc(`seasonResults/${seasonId}/potm/${potm.month}`), {
      month: potm.month,
      playerId: potm.playerId,
      gain: potm.gain,
      games: potm.games,
    });
  }
  await writer.close();

  return { ok: true, championId, runnerUpId, potmCount: potmResults.length };
});

export const createSeason = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const name = String(req.data?.name ?? "").trim();
  const startStr = String(req.data?.start ?? "").trim();
  const endStr = String(req.data?.end ?? "").trim();
  if (!name) throw new HttpsError("invalid-argument", "name is required.");
  if (!startStr || !endStr)
    throw new HttpsError("invalid-argument", "start and end dates required.");

  const startMs = Date.parse(startStr);
  const endMs = Date.parse(endStr);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
    throw new HttpsError("invalid-argument", "Invalid date format (use ISO 8601).");
  if (startMs >= endMs) throw new HttpsError("invalid-argument", "Start must be before end.");

  const seasonId = `season-${Date.now()}`;
  const joinCode = await generateUniqueJoinCode();
  await db.doc(`seasons/${seasonId}`).set({
    name,
    year: new Date(startMs).getFullYear(),
    start: Timestamp.fromMillis(startMs),
    end: Timestamp.fromMillis(endMs),
    active: false,
    finalized: false,
    joinCode,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, seasonId, joinCode };
});

export const activateSeason = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const seasonId = String(req.data?.seasonId ?? "").trim();
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");
  const ref = db.doc(`seasons/${seasonId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Season not found.");
  if (snap.get("finalized"))
    throw new HttpsError("failed-precondition", "Cannot activate a finalized season.");
  if (snap.get("active")) return { ok: true, seasonId };

  let joinCode = snap.get("joinCode") as string | undefined;
  if (!joinCode) {
    joinCode = await generateUniqueJoinCode();
  }

  const active = await db.collection("seasons").where("active", "==", true).get();
  const batch = db.batch();
  for (const doc of active.docs) {
    batch.update(doc.ref, { active: false });
  }
  batch.update(ref, { active: true, joinCode, activatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true, seasonId };
});

export const manageTeam = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const action = String(req.data?.action ?? "").trim();
  if (!["add", "rename", "deactivate"].includes(action))
    throw new HttpsError("invalid-argument", "action must be add, rename, or deactivate.");

  if (action === "add") {
    const name = String(req.data?.name ?? "").trim();
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const teamId = `team-${Date.now()}`;
    await db
      .doc(`teams/${teamId}`)
      .set({ name, active: true, createdAt: FieldValue.serverTimestamp() });
    return { ok: true, teamId, name };
  }

  const teamId = String(req.data?.teamId ?? "").trim();
  if (!teamId) throw new HttpsError("invalid-argument", "teamId is required.");
  const ref = db.doc(`teams/${teamId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Team not found.");

  if (action === "rename") {
    const name = String(req.data?.name ?? "").trim();
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    await ref.update({ name, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true, teamId, name };
  }

  if (action === "deactivate") {
    await ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true, teamId };
  }
  throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
});

export const resolveMatch = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const matchId = String(req.data?.matchId ?? "").trim();
  const action = String(req.data?.action ?? "").trim();
  const reason = String(req.data?.reason ?? "")
    .trim()
    .slice(0, 500);
  if (!matchId) throw new HttpsError("invalid-argument", "matchId is required.");
  if (!["confirm", "correct_confirm", "void"].includes(action)) {
    throw new HttpsError("invalid-argument", "action must be confirm, correct_confirm, or void.");
  }

  const ref = db.doc(`matches/${matchId}`);
  const previous = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");

    const data = snap.data()!;
    if (data.status === "confirmed" || data.status === "voided") {
      throw new HttpsError("failed-precondition", `Already ${data.status}.`);
    }

    const prev = {
      status: String(data.status),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      aTeamId: String(data.aTeamId ?? ""),
      bTeamId: String(data.bTeamId ?? ""),
      aTeam: String(data.aTeam ?? ""),
      bTeam: String(data.bTeam ?? ""),
    };

    if (action === "void") {
      tx.update(ref, {
        status: "voided",
        resolvedBy: uid,
        resolution: "voided",
        resolvedAt: FieldValue.serverTimestamp(),
        resolutionReason: reason || null,
        previousStatus: prev.status,
        previousScore: { aGoals: prev.aGoals, bGoals: prev.bGoals },
      });
      return { ...prev, seasonId: String(data.seasonId), submittedBy: String(data.submittedBy) };
    }

    if (action === "correct_confirm") {
      const corrected = (req.data?.correctedScore ?? {}) as { aGoals?: unknown; bGoals?: unknown };
      const aGoals = Number(corrected.aGoals ?? null);
      const bGoals = Number(corrected.bGoals ?? null);
      if (
        !Number.isInteger(aGoals) ||
        aGoals < 0 ||
        aGoals > 99 ||
        !Number.isInteger(bGoals) ||
        bGoals < 0 ||
        bGoals > 99
      ) {
        throw new HttpsError("invalid-argument", "Valid corrected score required.");
      }
      tx.update(ref, {
        aGoals,
        bGoals,
        status: "confirmed",
        confirmedBy: uid,
        confirmedAt: FieldValue.serverTimestamp(),
        resolvedBy: uid,
        resolution: "corrected",
        resolvedAt: FieldValue.serverTimestamp(),
        resolutionReason: reason || null,
        previousStatus: prev.status,
        previousScore: { aGoals: prev.aGoals, bGoals: prev.bGoals },
      });
      return {
        ...prev,
        seasonId: String(data.seasonId),
        submittedBy: String(data.submittedBy),
        aGoals,
        bGoals,
      };
    }

    // confirm (as-is)
    tx.update(ref, {
      status: "confirmed",
      confirmedBy: uid,
      confirmedAt: FieldValue.serverTimestamp(),
      resolvedBy: uid,
      resolution: "admin_confirm",
      resolvedAt: FieldValue.serverTimestamp(),
      resolutionReason: reason || null,
      previousStatus: prev.status,
    });
    return { ...prev, seasonId: String(data.seasonId), submittedBy: String(data.submittedBy) };
  });

  if (action !== "void") {
    await recalcSeasonElo(previous.seasonId);
    await recalcLeagueStats();
  }

  const opponentId = previous.submittedBy;
  if (opponentId && opponentId !== uid) {
    const body =
      action === "void"
        ? "A disputed match was voided by admin."
        : "An admin has resolved a pending match.";
    await sendPush(opponentId, "Match resolved", body, {
      type: action === "void" ? "match_disputed" : "match_confirmed",
      matchId,
    });
  }
  return { ok: true, matchId };
});

export const listSeasons = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  const memberSnap = await db.doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  const isAdmin = memberSnap.exists && memberSnap.get("role") === "admin";
  const snap = await db.collection("seasons").orderBy("start", "desc").get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    if (!isAdmin) delete data.joinCode;
    return { id: doc.id, ...data };
  });
});
