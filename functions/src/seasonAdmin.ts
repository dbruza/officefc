import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { loggedOnCall } from "./logging";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { computePOTM, type Standing } from "./elo";
import { requireAuth, assertAdmin, assertMember } from "./auth";
import { recalcSeasonElo, recalcLeagueStats } from "./recalc";
import { emitMatchActivity, emitSeasonActivity, topRankedLeaderId } from "./activityFeed";
import {
  dateMillis,
  generateUniqueJoinCode,
  readSeasonJoinCode,
  seasonMatchInputsWithTeams,
  writeSeasonJoinCode,
} from "./utils";
import { sendPush } from "./notify";
import { rebuildTeamCatalogueSnapshot } from "./teams";
import { applyFinalsResult } from "./finals";
import { assertSeasonAcceptsConfirmationsTx } from "./matchLifecycle";
import {
  bracketComplete,
  bracketRunnerUpId,
  type FinalsBracket,
  type FinalsDecidedBy,
  type FinalsSlotKey,
} from "./finalsRules";

const db = getFirestore();

export const finalizeSeason = loggedOnCall("finalizeSeason", { cors: true }, async (req) => {
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
  // Finals matches decide the bracket only — they never feed POTM or the table.
  const regularDocs = confirmed.docs.filter((doc) => doc.get("finals") !== true);
  if (regularDocs.length === 0)
    throw new HttpsError("failed-precondition", "No confirmed matches in this season.");

  const matchInputs = await seasonMatchInputsWithTeams(regularDocs, db);

  const standingsSnap = await db.collection(`seasons/${seasonId}/standings`).get();
  const finalStandings: Standing[] = standingsSnap.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }) as Standing)
    // Only ranked players hold a place; provisional players (rank 0) can't take the title.
    .filter((standing) => standing.rank >= 1)
    .sort((a, b) => a.rank - b.rank);

  // Finals-format seasons: Champion = Grand Final winner, Premier = table-topper at the
  // finals lock. Table-format seasons keep the original meaning (champion = rank 1).
  const bracketSnap = await db.doc(`seasons/${seasonId}/finals/bracket`).get();
  let championId: string | null;
  let runnerUpId: string | null;
  let premierId: string | null = null;
  let format: "table" | "finals" = "table";
  if (bracketSnap.exists) {
    const bracket = bracketSnap.data() as unknown as FinalsBracket;
    if (!bracketComplete(bracket)) {
      throw new HttpsError(
        "failed-precondition",
        "The Grand Final is not decided yet. Finish the bracket (or award a walkover) first.",
      );
    }
    championId = bracket.slots.gf?.winnerId ?? null;
    runnerUpId = bracketRunnerUpId(bracket);
    premierId = bracket.premierId;
    format = "finals";
  } else {
    championId = finalStandings[0]?.uid ?? null;
    runnerUpId = finalStandings[1]?.uid ?? null;
  }

  // POTM replays the season's rating walk, so it must see the same reigning-Premier
  // handicap that recalcSeasonElo applied to this season's matches.
  const reigningPremierId = data.reigningPremierId;
  const potmResults = computePOTM(matchInputs, {
    premierId: typeof reigningPremierId === "string" ? reigningPremierId : null,
  });

  const writer = db.bulkWriter();
  writer.set(
    ref,
    {
      active: false,
      finalized: true,
      finalizedAt: FieldValue.serverTimestamp(),
      ...(format === "finals" ? { phase: "finalized" } : {}),
    },
    { merge: true },
  );
  writer.set(db.doc(`seasonResults/${seasonId}`), {
    seasonId,
    championId,
    runnerUpId,
    premierId,
    format,
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

  await emitSeasonActivity({
    seasonId,
    seasonName: String(data.name ?? seasonId),
    championId,
    runnerUpId,
    premierId,
    potm: potmResults.map((potm) => ({
      month: potm.month,
      playerId: potm.playerId,
      gain: potm.gain,
    })),
  });

  return { ok: true, championId, runnerUpId, premierId, format, potmCount: potmResults.length };
});

export const createSeason = loggedOnCall("createSeason", { cors: true }, async (req) => {
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
    createdAt: FieldValue.serverTimestamp(),
  });
  await writeSeasonJoinCode(seasonId, joinCode);
  return { ok: true, seasonId, joinCode };
});

export const activateSeason = loggedOnCall("activateSeason", { cors: true }, async (req) => {
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

  let joinCode = await readSeasonJoinCode(seasonId);
  if (!joinCode) joinCode = await generateUniqueJoinCode();

  // Stamp the reigning Premier once, at first activation: the most recently finalized
  // season's table-topper (its champion for table-format seasons) carries the
  // PREMIER_HANDICAP_ELO handicap for this whole season. Never re-stamped on later
  // activations, so mid-season recalcs stay deterministic.
  let premierStamp = {};
  if (snap.get("reigningPremierId") === undefined) {
    const lastFinalized = await db
      .collection("seasonResults")
      .orderBy("finalizedAt", "desc")
      .limit(1)
      .get();
    const last = lastFinalized.docs[0];
    const titleHolder = last ? (last.get("premierId") ?? last.get("championId")) : null;
    premierStamp = { reigningPremierId: typeof titleHolder === "string" ? titleHolder : null };
  }

  const active = await db.collection("seasons").where("active", "==", true).get();
  const batch = db.batch();
  for (const doc of active.docs) {
    batch.update(doc.ref, { active: false });
  }
  batch.update(ref, {
    active: true,
    activatedAt: FieldValue.serverTimestamp(),
    ...premierStamp,
  });
  await batch.commit();
  await writeSeasonJoinCode(seasonId, joinCode);
  return { ok: true, seasonId };
});

export const manageTeam = loggedOnCall("manageTeam", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);

  const action = String(req.data?.action ?? "").trim();
  if (!["add", "rename", "deactivate", "reactivate"].includes(action))
    throw new HttpsError(
      "invalid-argument",
      "action must be add, rename, deactivate, or reactivate.",
    );

  if (action === "add") {
    const name = String(req.data?.name ?? "").trim();
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const teamId = `team-${Date.now()}`;
    await db.doc(`teams/${teamId}`).set({
      name,
      competition: "Custom",
      category: "custom",
      overall: null,
      attack: null,
      midfield: null,
      defence: null,
      catalogueVersion: null,
      source: "custom",
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    await rebuildTeamCatalogueSnapshot(db);
    return { ok: true, teamId, name };
  }

  const teamId = String(req.data?.teamId ?? "").trim();
  if (!teamId) throw new HttpsError("invalid-argument", "teamId is required.");
  const ref = db.doc(`teams/${teamId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Team not found.");

  if (action === "rename") {
    const name = String(req.data?.name ?? "").trim();
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    await ref.update({
      name,
      nameOverride: name,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await rebuildTeamCatalogueSnapshot(db);
    return { ok: true, teamId, name };
  }

  if (action === "deactivate") {
    await ref.update({
      active: false,
      activeOverride: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await rebuildTeamCatalogueSnapshot(db);
    return { ok: true, teamId };
  }

  if (action === "reactivate") {
    if (snap.get("source") === "catalogue" && snap.get("catalogueActive") === false) {
      throw new HttpsError(
        "failed-precondition",
        "Superseded catalogue teams cannot be reactivated.",
      );
    }
    await ref.update({
      active: true,
      activeOverride: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await rebuildTeamCatalogueSnapshot(db);
    return { ok: true, teamId };
  }
  throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
});

export const resolveMatch = loggedOnCall("resolveMatch", { cors: true }, async (req) => {
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
    // Same finalized-season guard as confirmMatch: a resolve after finalizeSeason would
    // mutate published standings with no re-publication. Voids are allowed through —
    // removing a result can't contradict the published champion.
    if (action !== "void") {
      await assertSeasonAcceptsConfirmationsTx(tx, String(data.seasonId));
    }

    const prev = {
      status: String(data.status),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      aTeamId: String(data.aTeamId ?? ""),
      bTeamId: String(data.bTeamId ?? ""),
      aTeam: String(data.aTeam ?? ""),
      bTeam: String(data.bTeam ?? ""),
      aId: String(data.aId ?? ""),
      bId: String(data.bId ?? ""),
      finals: data.finals === true,
      finalsSlot: typeof data.finalsSlot === "string" ? data.finalsSlot : null,
      decidedBy: typeof data.decidedBy === "string" ? data.decidedBy : null,
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
      if (data.finals === true && aGoals === bGoals) {
        throw new HttpsError(
          "invalid-argument",
          "Finals matches cannot end level — extra time and penalties decide a winner.",
        );
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

  let finalsApplied: boolean | null = null;
  if (action !== "void") {
    if (previous.finals && previous.finalsSlot) {
      // Admin-resolved finals matches advance the bracket; ELO/stats never see them.
      // The draw guard above makes an equal confirmed score impossible.
      const winnerId = previous.aGoals > previous.bGoals ? previous.aId : previous.bId;
      finalsApplied =
        (await applyFinalsResult({
          seasonId: previous.seasonId,
          slotKey: previous.finalsSlot as FinalsSlotKey,
          winnerId,
          matchId,
          decidedBy: (previous.decidedBy ?? "regulation") as FinalsDecidedBy,
          winnerGoals: Math.max(previous.aGoals, previous.bGoals),
          loserGoals: Math.min(previous.aGoals, previous.bGoals),
        })) === "applied";
      if (!finalsApplied) {
        logger.warn("finals_resolve_lost_slot_race", { matchId, seasonId: previous.seasonId });
      }
    } else {
      const previousLeaderId = await topRankedLeaderId(db, previous.seasonId);
      await recalcSeasonElo(previous.seasonId);
      await recalcLeagueStats();
      await emitMatchActivity({ db, matchId, seasonId: previous.seasonId, previousLeaderId });
    }
  }

  const opponentId = previous.submittedBy;
  if (opponentId && opponentId !== uid) {
    // A finals resolve that lost the slot race still confirmed the match, but the bracket
    // took the other result — don't tell the player it was resolved into anything.
    const body =
      action === "void"
        ? "A disputed match was voided by admin."
        : finalsApplied === false
          ? "Your match was confirmed by admin, but that tie had already been decided."
          : "An admin has resolved a pending match.";
    await sendPush(opponentId, "Match resolved", body, {
      type: action === "void" ? "match_disputed" : "match_confirmed",
      matchId,
    });
  }
  return { ok: true, matchId };
});

export const listSeasons = loggedOnCall("listSeasons", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const snap = await db.collection("seasons").orderBy("start", "desc").get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    // Join codes are function-only (see seasonCodes); never surface them, including any legacy
    // joinCode field still sitting on pre-migration season docs. Admins fetch codes via
    // getSeasonJoinCode.
    delete data.joinCode;
    return { id: doc.id, ...data };
  });
});
