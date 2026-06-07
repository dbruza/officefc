import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { LEAGUE_ID } from "../config";
import { sendPush } from "../notify";

const db = getFirestore();

function requireAuth(req: { auth?: { uid: string } }): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth.uid;
}

async function assertMember(uid: string): Promise<void> {
  const snap = await db.doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "League members only.");
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fieldsEdited(
  raw: Record<string, unknown> | null | undefined,
  submitted: Record<string, unknown>,
): string[] {
  const edited: string[] = [];
  if (!raw) return edited;
  function check(field: string, rawHome: unknown, rawAway: unknown): void {
    const subHome = submitted[`my${field}`];
    const subAway = submitted[`opponent${field}`];
    if (rawHome !== null && rawHome !== undefined && rawHome !== subHome) edited.push(`home_${field.toLowerCase()}`);
    if (rawAway !== null && rawAway !== undefined && rawAway !== subAway) edited.push(`away_${field.toLowerCase()}`);
  }
  const home = (raw.home ?? {}) as Record<string, unknown>;
  const away = (raw.away ?? {}) as Record<string, unknown>;
  check("Goals", home.goals, away.goals);
  check("Possession", home.possession, away.possession);
  check("Shots", home.shots, away.shots);
  check("ShotsOnTarget", home.shots_on_target, away.shots_on_target);
  return edited;
}

export const submitAiAssistedMatch = onCall(async (req) => {
  const uid = requireAuth(req);
  await assertMember(uid);

  const {
    draftId,
    seasonId,
    opponentId,
    mySide,
    myTeamId,
    opponentTeamId,
    submittedGoalsAndStats,
  } = req.data as {
    draftId?: string;
    seasonId?: string;
    opponentId?: string;
    mySide?: "home" | "away";
    myTeamId?: string;
    opponentTeamId?: string;
    submittedGoalsAndStats?: Record<string, unknown>;
  };

  if (!draftId) throw new HttpsError("invalid-argument", "draftId is required.");
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");
  if (!opponentId) throw new HttpsError("invalid-argument", "opponentId is required.");
  if (!mySide || !["home", "away"].includes(mySide))
    throw new HttpsError("invalid-argument", "mySide must be 'home' or 'away'.");
  if (!myTeamId || !opponentTeamId)
    throw new HttpsError("invalid-argument", "Both team ids are required.");
  if (!submittedGoalsAndStats || submittedGoalsAndStats.myGoals == null || submittedGoalsAndStats.opponentGoals == null)
    throw new HttpsError("invalid-argument", "Goals are required.");
  if (uid === opponentId) throw new HttpsError("invalid-argument", "You cannot play yourself.");

  const [draftSnap, seasonSnap, memberSnap, myTeamSnap, opponentTeamSnap] = await Promise.all([
    db.doc(`matchDrafts/${draftId}`).get(),
    db.doc(`seasons/${seasonId}`).get(),
    db.doc(`leagues/${LEAGUE_ID}/members/${opponentId}`).get(),
    db.doc(`teams/${myTeamId}`).get(),
    db.doc(`teams/${opponentTeamId}`).get(),
  ]);

  if (!draftSnap.exists) throw new HttpsError("not-found", "AI draft not found.");
  const draft = draftSnap.data()!;
  if (draft.ownerUid !== uid) throw new HttpsError("permission-denied", "Not your draft.");
  if (draft.status !== "done") throw new HttpsError("failed-precondition", "Extraction not done.");
  if (draft.submitted) throw new HttpsError("failed-precondition", "Already submitted.");
  if (!seasonSnap.exists || !seasonSnap.get("active"))
    throw new HttpsError("failed-precondition", "No active season.");
  if (!memberSnap.exists) throw new HttpsError("invalid-argument", "Opponent not a member.");
  if (!myTeamSnap.exists || !myTeamSnap.get("active"))
    throw new HttpsError("invalid-argument", "Your team not active.");
  if (!opponentTeamSnap.exists || !opponentTeamSnap.get("active"))
    throw new HttpsError("invalid-argument", "Opponent team not active.");

  const myGoals = Number(submittedGoalsAndStats.myGoals);
  const oppGoals = Number(submittedGoalsAndStats.opponentGoals);
  if (!Number.isInteger(myGoals) || myGoals < 0 || myGoals > 99)
    throw new HttpsError("invalid-argument", "Invalid goal count.");
  if (!Number.isInteger(oppGoals) || oppGoals < 0 || oppGoals > 99)
    throw new HttpsError("invalid-argument", "Invalid goal count.");

  const extraction = draft.raw as Record<string, unknown> | undefined;
  const suggestion = (extraction?.suggestion ?? {}) as Record<string, unknown>;
  const editedFields = fieldsEdited(suggestion, submittedGoalsAndStats);

  const isHomeSide = mySide === "home";
  const matchData = {
    seasonId,
    submittedBy: uid,
    aId: isHomeSide ? uid : opponentId,
    bId: isHomeSide ? opponentId : uid,
    aTeamId: isHomeSide ? myTeamId : opponentTeamId,
    bTeamId: isHomeSide ? opponentTeamId : myTeamId,
    aTeam: isHomeSide ? (myTeamSnap.get("name") as string) : (opponentTeamSnap.get("name") as string),
    bTeam: isHomeSide ? (opponentTeamSnap.get("name") as string) : (myTeamSnap.get("name") as string),
    aGoals: isHomeSide ? myGoals : oppGoals,
    bGoals: isHomeSide ? oppGoals : myGoals,
    status: "pending_confirmation",
    source: "ai_assisted",
    date: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    photoPath: (draft.storagePath as string) ?? null,
    extractionConfidence: extraction?.confidence ?? null,
    extractionFlags: extraction?.flags ?? [],
    extractionModel: draft.model ?? null,
    extractionEditedByHuman: editedFields.length > 0 ? editedFields : null,
    extractedAt: draft.extractedAt ?? null,
    aPossession: isHomeSide ? nullableNum(submittedGoalsAndStats.myPossession) : nullableNum(submittedGoalsAndStats.opponentPossession),
    bPossession: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentPossession) : nullableNum(submittedGoalsAndStats.myPossession),
    aShots: isHomeSide ? nullableNum(submittedGoalsAndStats.myShots) : nullableNum(submittedGoalsAndStats.opponentShots),
    bShots: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentShots) : nullableNum(submittedGoalsAndStats.myShots),
    aShotsOnTarget: isHomeSide ? nullableNum(submittedGoalsAndStats.myShotsOnTarget) : nullableNum(submittedGoalsAndStats.opponentShotsOnTarget),
    bShotsOnTarget: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentShotsOnTarget) : nullableNum(submittedGoalsAndStats.myShotsOnTarget),
    rawExtraction: extraction ?? null,
  };

  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`matches/${draftId}`), matchData);
    tx.update(db.doc(`matchDrafts/${draftId}`), {
      submitted: true,
      submittedAt: FieldValue.serverTimestamp(),
    });
  });

  await sendPush(opponentId, "Result needs your nod", `${matchData.aGoals}-${matchData.bGoals} score submitted.`, {
    type: "match_pending",
    matchId: draftId,
  });

  return { ok: true, matchId: draftId };
});
