import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { LEAGUE_ID } from "../config";
import {
  assertValidDraftId,
  DraftSecurityError,
  evaluateDraftSubmission,
  type DraftState,
  type MatchState,
} from "./draftSecurity";

const db = getFirestore();

function requireAuth(req: { auth?: { uid: string } }): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth.uid;
}

async function assertMember(uid: string): Promise<void> {
  const snap = await db.doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "League members only.");
}

function asHttpsError(error: DraftSecurityError): HttpsError {
  return new HttpsError(error.code, error.message);
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
  try {
    assertValidDraftId(draftId);
  } catch (error) {
    if (error instanceof DraftSecurityError) throw asHttpsError(error);
    throw error;
  }
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");
  if (!opponentId) throw new HttpsError("invalid-argument", "opponentId is required.");
  if (!mySide || !["home", "away"].includes(mySide))
    throw new HttpsError("invalid-argument", "mySide must be 'home' or 'away'.");
  if (!myTeamId || !opponentTeamId)
    throw new HttpsError("invalid-argument", "Both team ids are required.");
  if (!submittedGoalsAndStats || submittedGoalsAndStats.myGoals == null || submittedGoalsAndStats.opponentGoals == null)
    throw new HttpsError("invalid-argument", "Goals are required.");
  if (uid === opponentId) throw new HttpsError("invalid-argument", "You cannot play yourself.");

  const myGoals = Number(submittedGoalsAndStats.myGoals);
  const oppGoals = Number(submittedGoalsAndStats.opponentGoals);
  if (!Number.isInteger(myGoals) || myGoals < 0 || myGoals > 99)
    throw new HttpsError("invalid-argument", "Invalid goal count.");
  if (!Number.isInteger(oppGoals) || oppGoals < 0 || oppGoals > 99)
    throw new HttpsError("invalid-argument", "Invalid goal count.");

  const draftRef = db.doc(`matchDrafts/${draftId}`);
  const matchRef = db.doc(`matches/${draftId}`);
  const seasonRef = db.doc(`seasons/${seasonId}`);
  const opponentMemberRef = db.doc(`leagues/${LEAGUE_ID}/members/${opponentId}`);
  const myTeamRef = db.doc(`teams/${myTeamId}`);
  const opponentTeamRef = db.doc(`teams/${opponentTeamId}`);

  await db.runTransaction(async (tx) => {
    const draftSnap = await tx.get(draftRef);
    const matchSnap = await tx.get(matchRef);
    const seasonSnap = await tx.get(seasonRef);
    const memberSnap = await tx.get(opponentMemberRef);
    const myTeamSnap = await tx.get(myTeamRef);
    const opponentTeamSnap = await tx.get(opponentTeamRef);
    const draft = draftSnap.exists ? (draftSnap.data() as DraftState & Record<string, unknown>) : null;
    const match = matchSnap.exists ? (matchSnap.data() as MatchState) : null;

    let action;
    try {
      action = evaluateDraftSubmission({ draft, match, draftId, uid });
    } catch (error) {
      if (error instanceof DraftSecurityError) throw asHttpsError(error);
      throw error;
    }
    if (action === "existing") return;

    if (!seasonSnap.exists || !seasonSnap.get("active"))
      throw new HttpsError("failed-precondition", "No active season.");
    if (!memberSnap.exists) throw new HttpsError("invalid-argument", "Opponent not a member.");
    if (!myTeamSnap.exists || !myTeamSnap.get("active"))
      throw new HttpsError("invalid-argument", "Your team not active.");
    if (!opponentTeamSnap.exists || !opponentTeamSnap.get("active"))
      throw new HttpsError("invalid-argument", "Opponent team not active.");

    const extraction = draft?.raw as Record<string, unknown> | undefined;
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
      photoPath: (draft?.storagePath as string) ?? null,
      extractionConfidence: extraction?.confidence ?? null,
      extractionFlags: extraction?.flags ?? [],
      extractionModel: draft?.model ?? null,
      extractionEditedByHuman: editedFields.length > 0 ? editedFields : null,
      extractedAt: draft?.extractedAt ?? null,
      aPossession: isHomeSide ? nullableNum(submittedGoalsAndStats.myPossession) : nullableNum(submittedGoalsAndStats.opponentPossession),
      bPossession: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentPossession) : nullableNum(submittedGoalsAndStats.myPossession),
      aShots: isHomeSide ? nullableNum(submittedGoalsAndStats.myShots) : nullableNum(submittedGoalsAndStats.opponentShots),
      bShots: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentShots) : nullableNum(submittedGoalsAndStats.myShots),
      aShotsOnTarget: isHomeSide ? nullableNum(submittedGoalsAndStats.myShotsOnTarget) : nullableNum(submittedGoalsAndStats.opponentShotsOnTarget),
      bShotsOnTarget: isHomeSide ? nullableNum(submittedGoalsAndStats.opponentShotsOnTarget) : nullableNum(submittedGoalsAndStats.myShotsOnTarget),
      rawExtraction: extraction ?? null,
    };

    tx.create(matchRef, matchData);
    tx.update(draftRef, {
      submitted: true,
      submittedMatchId: draftId,
      submittedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, matchId: draftId };
});
