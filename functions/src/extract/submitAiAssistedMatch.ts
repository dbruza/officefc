import { HttpsError } from "firebase-functions/v2/https";
import { loggedOnCall } from "../logging";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { LEAGUE_ID } from "../config";
import { requireAuth, assertMember } from "../auth";
import {
  asHttpsError,
  assertValidDraftId,
  DraftSecurityError,
  evaluateDraftSubmission,
  isSubmittableTeam,
  type DraftState,
  type MatchState,
} from "./draftSecurity";
import { fieldsEdited } from "./extractionAudit";
import { checkScoreConsistency } from "./core/statsCheck.mjs";
import { BLOCKED_MATCH_MESSAGE, isActiveMember, isBlockedBetween } from "../members";

const db = getFirestore();

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Bounds for the optional stats the client submits alongside goals. The AI extraction
 *  normalizes its own suggestions, but the human can overwrite any value in the review
 *  step and nothing else re-checks it — so the callable is the trust boundary. */
const STAT_BOUNDS: Record<string, { min: number; max: number; integer?: boolean }> = {
  possession: { min: 0, max: 100 },
  shots: { min: 0, max: 99, integer: true },
  shotsOnTarget: { min: 0, max: 99, integer: true },
  xg: { min: 0, max: 15 },
  saves: { min: 0, max: 99, integer: true },
  ballRecoveryTime: { min: 0, max: 120 },
};

/** Reject out-of-range submitted stats with an invalid-argument naming the field. */
function assertStatsInRange(submitted: Record<string, unknown>): void {
  for (const [name, bounds] of Object.entries(STAT_BOUNDS)) {
    for (const prefix of ["my", "opponent"] as const) {
      const key = `${prefix}${name[0].toUpperCase()}${name.slice(1)}`;
      const value = nullableNum(submitted[key]);
      if (value === null) continue; // absent stats are legitimate
      if (bounds.integer && !Number.isInteger(value))
        throw new HttpsError("invalid-argument", `Invalid ${key}.`);
      if (value < bounds.min || value > bounds.max)
        throw new HttpsError("invalid-argument", `Invalid ${key}.`);
    }
  }
}

export const submitAiAssistedMatch = loggedOnCall(
  "submitAiAssistedMatch",
  { cors: true },
  async (req) => {
    const { uid } = requireAuth(req);
    await assertMember(uid);

    const {
      draftId,
      seasonId,
      opponentId,
      mySide,
      myTeamId,
      opponentTeamId,
      fixtureId,
      submittedGoalsAndStats,
    } = req.data as {
      draftId?: string;
      seasonId?: string;
      opponentId?: string;
      mySide?: "home" | "away";
      myTeamId?: string;
      opponentTeamId?: string;
      fixtureId?: string;
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
    if (
      !submittedGoalsAndStats ||
      submittedGoalsAndStats.myGoals == null ||
      submittedGoalsAndStats.opponentGoals == null
    )
      throw new HttpsError("invalid-argument", "Goals are required.");
    if (uid === opponentId) throw new HttpsError("invalid-argument", "You cannot play yourself.");

    const myGoals = Number(submittedGoalsAndStats.myGoals);
    const oppGoals = Number(submittedGoalsAndStats.opponentGoals);
    if (!Number.isInteger(myGoals) || myGoals < 0 || myGoals > 99)
      throw new HttpsError("invalid-argument", "Invalid goal count.");
    if (!Number.isInteger(oppGoals) || oppGoals < 0 || oppGoals > 99)
      throw new HttpsError("invalid-argument", "Invalid goal count.");
    assertStatsInRange(submittedGoalsAndStats);

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
      const fixtureSnap = fixtureId ? await tx.get(db.doc(`fixtures/${fixtureId}`)) : null;
      const blocked = await isBlockedBetween(uid, opponentId, tx);
      const draft = draftSnap.exists
        ? (draftSnap.data() as DraftState & Record<string, unknown>)
        : null;
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
      if (!isActiveMember(memberSnap))
        throw new HttpsError("invalid-argument", "Opponent not a member.");
      if (blocked) throw new HttpsError("failed-precondition", BLOCKED_MATCH_MESSAGE);
      // A dealt fixture pins both teams (checked below), so it stays playable after a
      // catalogue sync retires them.
      const pinnedByFixture = fixtureSnap !== null;
      if (!isSubmittableTeam(myTeamSnap, pinnedByFixture))
        throw new HttpsError("invalid-argument", "Your team not active.");
      if (!isSubmittableTeam(opponentTeamSnap, pinnedByFixture))
        throw new HttpsError("invalid-argument", "Opponent team not active.");

      // Auto-matchup submissions must honor the dealt fixture: same season, same pair,
      // and each player using exactly the team the engine assigned them.
      if (fixtureSnap) {
        if (!fixtureSnap.exists) throw new HttpsError("not-found", "Fixture not found.");
        const fixture = fixtureSnap.data()!;
        if (fixture.seasonId !== seasonId)
          throw new HttpsError("failed-precondition", "Fixture is for a different season.");
        if (fixture.status !== "proposed")
          throw new HttpsError("failed-precondition", "Fixture has already been played.");
        const pairMatches =
          (fixture.aId === uid && fixture.bId === opponentId) ||
          (fixture.aId === opponentId && fixture.bId === uid);
        if (!pairMatches)
          throw new HttpsError("permission-denied", "Fixture is for different players.");
        const myFixtureTeam = fixture.aId === uid ? fixture.aTeamId : fixture.bTeamId;
        const oppFixtureTeam = fixture.aId === uid ? fixture.bTeamId : fixture.aTeamId;
        if (myTeamId !== myFixtureTeam || opponentTeamId !== oppFixtureTeam)
          throw new HttpsError(
            "failed-precondition",
            "Teams don't match the fixture. Play with the dealt teams or record manually.",
          );
      }

      const extraction = draft?.raw as Record<string, unknown> | undefined;
      const suggestion = (extraction?.suggestion ?? {}) as Record<string, unknown>;
      const isHomeSide = mySide === "home";
      const editedFields = fieldsEdited(suggestion, submittedGoalsAndStats, mySide);
      // Re-run the score cross-check on what the player actually submitted (they may have
      // edited the AI's reads). Recorded for audit, never blocking: after review, the player
      // is the authority — the app asks them to confirm the score when it disagrees.
      const statsCheck = checkScoreConsistency(
        {
          goals: myGoals,
          shots_on_target: nullableNum(submittedGoalsAndStats.myShotsOnTarget),
          saves: nullableNum(submittedGoalsAndStats.mySaves),
        },
        {
          goals: oppGoals,
          shots_on_target: nullableNum(submittedGoalsAndStats.opponentShotsOnTarget),
          saves: nullableNum(submittedGoalsAndStats.opponentSaves),
        },
      ).status;
      const matchData = {
        seasonId,
        submittedBy: uid,
        aId: isHomeSide ? uid : opponentId,
        bId: isHomeSide ? opponentId : uid,
        aTeamId: isHomeSide ? myTeamId : opponentTeamId,
        bTeamId: isHomeSide ? opponentTeamId : myTeamId,
        aTeam: isHomeSide
          ? (myTeamSnap.get("name") as string)
          : (opponentTeamSnap.get("name") as string),
        bTeam: isHomeSide
          ? (opponentTeamSnap.get("name") as string)
          : (myTeamSnap.get("name") as string),
        aGoals: isHomeSide ? myGoals : oppGoals,
        bGoals: isHomeSide ? oppGoals : myGoals,
        status: "pending_confirmation",
        source: "ai_assisted",
        ...(fixtureId ? { fixtureId } : {}),
        date: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        photoPath: (draft?.storagePath as string) ?? null,
        extractionConfidence: extraction?.confidence ?? null,
        extractionFlags: extraction?.flags ?? [],
        extractionModel: draft?.model ?? null,
        extractionEditedByHuman: editedFields.length > 0 ? editedFields : null,
        extractedAt: draft?.extractedAt ?? null,
        aPossession: isHomeSide
          ? nullableNum(submittedGoalsAndStats.myPossession)
          : nullableNum(submittedGoalsAndStats.opponentPossession),
        bPossession: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentPossession)
          : nullableNum(submittedGoalsAndStats.myPossession),
        aShots: isHomeSide
          ? nullableNum(submittedGoalsAndStats.myShots)
          : nullableNum(submittedGoalsAndStats.opponentShots),
        bShots: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentShots)
          : nullableNum(submittedGoalsAndStats.myShots),
        aShotsOnTarget: isHomeSide
          ? nullableNum(submittedGoalsAndStats.myShotsOnTarget)
          : nullableNum(submittedGoalsAndStats.opponentShotsOnTarget),
        bShotsOnTarget: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentShotsOnTarget)
          : nullableNum(submittedGoalsAndStats.myShotsOnTarget),
        aXg: isHomeSide
          ? nullableNum(submittedGoalsAndStats.myXg)
          : nullableNum(submittedGoalsAndStats.opponentXg),
        bXg: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentXg)
          : nullableNum(submittedGoalsAndStats.myXg),
        aSaves: isHomeSide
          ? nullableNum(submittedGoalsAndStats.mySaves)
          : nullableNum(submittedGoalsAndStats.opponentSaves),
        bSaves: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentSaves)
          : nullableNum(submittedGoalsAndStats.mySaves),
        aBallRecoveryTime: isHomeSide
          ? nullableNum(submittedGoalsAndStats.myBallRecoveryTime)
          : nullableNum(submittedGoalsAndStats.opponentBallRecoveryTime),
        bBallRecoveryTime: isHomeSide
          ? nullableNum(submittedGoalsAndStats.opponentBallRecoveryTime)
          : nullableNum(submittedGoalsAndStats.myBallRecoveryTime),
        statsCheck,
        // The player saw the "score doesn't match the stats" warning and kept their score.
        scoreConfirmedOverStats:
          statsCheck === "mismatch" && submittedGoalsAndStats.scoreConfirmed === true,
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
  },
);
