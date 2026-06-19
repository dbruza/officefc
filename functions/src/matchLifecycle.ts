import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { requireAuth, assertMember } from "./auth";
import { recalcSeasonElo, recalcLeagueStats } from "./recalc";
import { sendPush } from "./notify";
import { responderRejection } from "./matchRules";

/** Only the named opponent can confirm a pending match. */
export const confirmMatch = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    const rejection = responderRejection(data, uid);
    if (rejection === "not_opponent") {
      throw new HttpsError("permission-denied", "Only the named opponent can confirm.");
    }
    if (rejection === "not_pending") {
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
export const disputeMatch = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const matchId = String(req.data?.matchId ?? "").trim();
  const reason = String(req.data?.reason ?? "")
    .trim()
    .slice(0, 240);
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  const submittedBy = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    const rejection = responderRejection(data, uid);
    if (rejection === "not_opponent") {
      throw new HttpsError("permission-denied", "Only the named opponent can dispute.");
    }
    if (rejection === "not_pending") {
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
export const deleteMatchPhoto = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "matchId is required.");

  const db = getFirestore();
  const ref = db.doc(`matches/${matchId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const data = snap.data()!;
    if (data.submittedBy !== uid)
      throw new HttpsError("permission-denied", "Only the submitter can delete their photo.");
    const photoPath = String(data.photoPath ?? "");
    if (!photoPath) throw new HttpsError("not-found", "No photo stored for this match.");

    const bucket = getStorage().bucket();
    const [exists] = await bucket.file(photoPath).exists();
    if (exists) await bucket.file(photoPath).delete();

    tx.update(ref, {
      photoPath: FieldValue.delete(),
      photoDeletedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, matchId };
});
