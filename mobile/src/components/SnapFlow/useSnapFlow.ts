/**
 * State machine for the photo flow: pick/drop/paste an image → upload + AI extraction
 * (a staged checklist) → which side you were → opponent → teams → verify & submit → done.
 * Every failure lands back on a step with friendly copy; none of them disables the flow.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { uploadMatchPhoto } from "@/lib/upload";
import {
  canUseCamera,
  releaseMatchPhoto,
  pickMatchPhoto,
  prepareWebImageFile,
  type SelectedMatchPhoto,
} from "@/lib/photoPicker";
import { matchTeamName } from "@/lib/teamSearch";
import { friendlyError } from "@/lib/friendlyError";
import { checkScore } from "@/lib/league/statsCheck";
import {
  abandonMatchDraft,
  callExtractMatchStats,
  submitAiAssistedMatch,
  previewElo,
  type LeaguePlayer,
  type Team,
} from "@/lib/league";
import type { Player } from "@/types";
import { pause } from "./helpers";
import type { ExtractionResult, SnapFlowProps, SnapPhase, SnapStep } from "./types";

/** Bounded error fields for logging; `code` picks up UploadError/Firebase error codes. */
function errorContext(err: unknown): { message: string; code: string | null } {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : null;
  return { message: err instanceof Error ? err.message : String(err), code };
}

export function useSnapFlow(props: SnapFlowProps) {
  const {
    uid,
    profile,
    season,
    players,
    teams,
    standings,
    opponentHistory,
    myRecentTeamIds,
    initialOpponentId,
    onCancel,
    onManualFallback,
    onViewMatch,
    onDone,
  } = props;

  const me: Player = {
    id: uid,
    name: profile.displayName,
    handle: profile.handle,
    jersey: profile.jersey,
    color: profile.color,
    isYou: true,
  };
  // Touch-first devices get "Take a photo"; a desktop browser only gets the file picker
  // (plus drag-and-drop and paste), whatever its window width.
  const [showCameraOption] = useState(canUseCamera);

  const [step, setStep] = useState<SnapStep>("capture");
  const [phase, setPhase] = useState<SnapPhase>("uploading");
  const [imageUri, setImageUri] = useState<string | null>(null);
  useEffect(() => () => releaseMatchPhoto(imageUri), [imageUri]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mySide, setMySide] = useState<"home" | "away">("home");
  // Nothing is preselected on the side step: the AI can't know which side you were.
  const [sideChosen, setSideChosen] = useState(false);
  const [opponent, setOpponent] = useState<LeaguePlayer | null>(
    () => players.find((player) => player.id === initialOpponentId) ?? null,
  );
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myGoals, setMyGoals] = useState(0);
  const [opponentGoals, setOpponentGoals] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedMatchId, setSubmittedMatchId] = useState<string | null>(null);
  const [myPossession, setMyPossession] = useState<number | null>(null);
  const [opponentPossession, setOpponentPossession] = useState<number | null>(null);
  const [myShots, setMyShots] = useState<number | null>(null);
  const [opponentShots, setOpponentShots] = useState<number | null>(null);
  const [myShotsOnTarget, setMyShotsOnTarget] = useState<number | null>(null);
  const [opponentShotsOnTarget, setOpponentShotsOnTarget] = useState<number | null>(null);
  const [myXg, setMyXg] = useState<number | null>(null);
  const [opponentXg, setOpponentXg] = useState<number | null>(null);
  const [mySaves, setMySaves] = useState<number | null>(null);
  const [opponentSaves, setOpponentSaves] = useState<number | null>(null);
  const [myBallRecoveryTime, setMyBallRecoveryTime] = useState<number | null>(null);
  const [opponentBallRecoveryTime, setOpponentBallRecoveryTime] = useState<number | null>(null);
  /** The player saw "the score doesn't match the stats" and said the score is right anyway. */
  const [scoreConfirmed, setScoreConfirmed] = useState(false);
  const activeDraftId = useRef<string | null>(null);
  const cancelRequested = useRef(false);

  const ratingByUid = useMemo(() => new Map(standings.map((s) => [s.uid, s.elo])), [standings]);
  const gamesByUid = useMemo(
    () => new Map(standings.map((s) => [s.uid, s.w + s.d + s.l])),
    [standings],
  );
  const myElo = ratingByUid.get(uid) ?? 1500;
  const opponentElo = ratingByUid.get(opponent?.id ?? "") ?? 1500;
  const myGames = gamesByUid.get(uid) ?? 0;
  const opponentGames = gamesByUid.get(opponent?.id ?? "") ?? 0;
  const myDelta = opponent
    ? previewElo(
        myElo,
        opponentElo,
        myGoals,
        opponentGoals,
        myTeam?.overall,
        opponentTeam?.overall,
        myGames,
        season?.reigningPremierId ?? null,
        uid,
        opponent.id,
        {
          myXg: myXg,
          opponentXg: opponentXg,
          myPossession: myPossession,
          opponentPossession: opponentPossession,
        },
      )
    : 0;
  const opponentDelta = opponent
    ? previewElo(
        opponentElo,
        myElo,
        opponentGoals,
        myGoals,
        opponentTeam?.overall,
        myTeam?.overall,
        opponentGames,
        season?.reigningPremierId ?? null,
        opponent.id,
        uid,
        {
          myXg: opponentXg,
          opponentXg: myXg,
          myPossession: opponentPossession,
          opponentPossession: myPossession,
        },
      )
    : 0;

  const usesExtraction = extraction?.suggestion != null && extraction.ok;

  // Pre-fill the editable stat fields from the AI extraction, mapped to my/opponent side.
  useEffect(() => {
    if (!usesExtraction || !extraction?.suggestion) return;
    const s = extraction.suggestion;
    const isHome = mySide === "home";
    const myExtract = isHome ? s.home : s.away;
    const oppExtract = isHome ? s.away : s.home;
    setMyGoals(myExtract.goals ?? 0);
    setOpponentGoals(oppExtract.goals ?? 0);
    setMyPossession(myExtract.possession);
    setOpponentPossession(oppExtract.possession);
    setMyShots(myExtract.shots);
    setOpponentShots(oppExtract.shots);
    setMyShotsOnTarget(myExtract.shots_on_target);
    setOpponentShotsOnTarget(oppExtract.shots_on_target);
    setMyXg(myExtract.xg);
    setOpponentXg(oppExtract.xg);
    setMySaves(myExtract.saves ?? null);
    setOpponentSaves(oppExtract.saves ?? null);
    setMyBallRecoveryTime(myExtract.ball_recovery_time ?? null);
    setOpponentBallRecoveryTime(oppExtract.ball_recovery_time ?? null);
  }, [mySide, extraction, usesExtraction]);

  // Live cross-check of the score against shots on target − the other keeper's saves. It runs
  // on the CURRENT values, so fixing a misread clears the warning straight away.
  const scoreCheck = useMemo(
    () =>
      checkScore(
        { goals: myGoals, shotsOnTarget: myShotsOnTarget, saves: mySaves },
        { goals: opponentGoals, shotsOnTarget: opponentShotsOnTarget, saves: opponentSaves },
      ),
    [myGoals, opponentGoals, myShotsOnTarget, opponentShotsOnTarget, mySaves, opponentSaves],
  );
  // Any change to the checked values asks again — a confirmation covers one set of numbers.
  useEffect(() => {
    setScoreConfirmed(false);
  }, [myGoals, opponentGoals, myShotsOnTarget, opponentShotsOnTarget, mySaves, opponentSaves]);
  const scoreNeedsCheck = scoreCheck.status === "mismatch" && !scoreConfirmed;

  /** Replace each disagreeing side's goals with what shots on target − saves implies. */
  function applyImpliedScore() {
    if (scoreCheck.mine && !scoreCheck.mine.ok) setMyGoals(scoreCheck.mine.implied);
    if (scoreCheck.theirs && !scoreCheck.theirs.ok) setOpponentGoals(scoreCheck.theirs.implied);
  }

  // Catalogue teams matched from the team names the AI read, mapped to my/opponent side.
  const teamGuesses = useMemo(() => {
    if (!usesExtraction || !extraction?.suggestion) return { my: null, opp: null };
    const s = extraction.suggestion;
    const isHome = mySide === "home";
    return {
      my: matchTeamName(teams, (isHome ? s.home : s.away).team_name),
      opp: matchTeamName(teams, (isHome ? s.away : s.home).team_name),
    };
  }, [usesExtraction, extraction, mySide, teams]);

  // Apply the guesses without clobbering a manual pick: a slot stays auto (remappable on
  // side change) until the user chooses a team themselves in the Teams step.
  const autoTeamRef = useRef({ my: false, opp: false });
  useEffect(() => {
    if (teamGuesses.my) {
      setMyTeam((current) => {
        if (current && !autoTeamRef.current.my) return current;
        autoTeamRef.current.my = true;
        return teamGuesses.my;
      });
    }
    if (teamGuesses.opp) {
      setOpponentTeam((current) => {
        if (current && !autoTeamRef.current.opp) return current;
        autoTeamRef.current.opp = true;
        return teamGuesses.opp;
      });
    }
  }, [teamGuesses]);

  async function cleanupDraft(id = activeDraftId.current): Promise<void> {
    if (!id) return;
    try {
      await abandonMatchDraft(id);
      if (activeDraftId.current === id) activeDraftId.current = null;
      setDraftId((current) => (current === id ? null : current));
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Could not remove the abandoned upload.",
        { cause: err },
      );
    }
  }

  /** Shared tail of every way in (picker, camera, drop, paste). */
  async function handlePicked(read: () => Promise<SelectedMatchPhoto | null>, source: string) {
    cancelRequested.current = false;
    setError(null);
    try {
      const selected = await read();
      if (!selected) return;
      await cleanupDraft();
      setExtraction(null);
      setImageUri(selected.uri);
      await handleUpload(selected.uri, selected.mimeType, selected.fileSize);
    } catch (err) {
      logger.error("snap_select_failed", { ...errorContext(err), source });
      setError(friendlyError(err, "Couldn't open that image. Try a JPEG or PNG screenshot."));
      setStep("capture");
    }
  }

  function handleSelect(source: "camera" | "library") {
    return handlePicked(() => pickMatchPhoto(source), source);
  }

  /** Web: an image dropped onto the page or pasted from the clipboard. */
  function handleFile(file: File) {
    return handlePicked(() => prepareWebImageFile(file), "drop_or_paste");
  }

  async function handleLeave(destination: "cancel" | "manual") {
    cancelRequested.current = true;
    try {
      await cleanupDraft();
    } catch (err) {
      // Daily server cleanup is the fallback if the browser is offline while leaving.
      logger.warn("snap_cleanup_failed", errorContext(err));
    }
    if (destination === "manual") onManualFallback(opponent?.id);
    else onCancel();
  }

  async function handleUpload(uri: string, mimeType?: string, fileSize?: number) {
    setStep("processing");
    setPhase("uploading");
    setError(null);
    try {
      const upload = await uploadMatchPhoto(uid, uri, mimeType, fileSize);
      activeDraftId.current = upload.draftId;
      setDraftId(upload.draftId);
      if (cancelRequested.current) {
        await cleanupDraft(upload.draftId);
        return;
      }
      setPhase("reading");
      await handleExtract(upload.draftId, upload.storagePath);
    } catch (err) {
      logger.error("snap_upload_failed", errorContext(err));
      setError(friendlyError(err, "The photo didn't upload. Check your connection and try again."));
      setStep("capture");
    }
  }

  async function handleExtract(id: string, path: string) {
    setError(null);
    try {
      const result = await callExtractMatchStats(id, path);
      const ext = result as unknown as ExtractionResult;
      setExtraction(ext);

      if (!ext.ok) {
        // Expected user mistake (wrong screen photographed) — warn keeps the error band actionable.
        logger.warn("snap_extract_rejected", { reason: "not_stats_screen", draftId: id });
        setError("This doesn't look like a stats screen. Try a different photo, or log manually.");
        setStep("capture");
        return;
      }
      if (
        ext.suggestion &&
        ext.suggestion.home.goals == null &&
        ext.suggestion.away.goals == null
      ) {
        logger.warn("snap_extract_rejected", { reason: "score_unreadable", draftId: id });
        setError("Couldn't read the score from this image. Try a clearer photo, or log manually.");
        setStep("capture");
        return;
      }
      // Team matching is local and instant; hold the last checklist tick for a beat so the
      // player sees all three stages land before the screen changes.
      setPhase("matching");
      await pause(450);
      if (cancelRequested.current) return;
      setStep("side");
    } catch (err) {
      logger.error("snap_extract_failed", { ...errorContext(err), draftId: id });
      setError(
        friendlyError(err, "The AI couldn't read that photo just now. Try again, or log manually."),
      );
      setStep("capture");
    }
  }

  function chooseSide(side: "home" | "away") {
    setMySide(side);
    setSideChosen(true);
    // An opponent picked before the photo (deep link / mode switch) skips that step.
    setStep(opponent ? "teams" : "opponent");
  }

  function chooseOpponent(player: LeaguePlayer) {
    setOpponent(player);
    // Let the check pop before moving on.
    setTimeout(() => setStep("teams"), 160);
  }

  async function handleSubmit() {
    if (!draftId || !season || !opponent || !myTeam || !opponentTeam) return;
    if (scoreNeedsCheck) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { matchId } = await submitAiAssistedMatch({
        draftId,
        seasonId: season.id,
        opponentId: opponent.id,
        mySide,
        myTeamId: myTeam.id,
        opponentTeamId: opponentTeam.id,
        submittedGoalsAndStats: {
          myGoals,
          opponentGoals,
          myPossession,
          opponentPossession,
          myShots,
          opponentShots,
          myShotsOnTarget,
          opponentShotsOnTarget,
          myXg,
          opponentXg,
          mySaves,
          opponentSaves,
          myBallRecoveryTime,
          opponentBallRecoveryTime,
          scoreConfirmed,
        },
      });
      activeDraftId.current = null;
      setSubmittedMatchId(matchId ?? null);
      setStep("done");
    } catch (err) {
      logger.error("snap_submit_failed", { ...errorContext(err), draftId });
      setError(
        friendlyError(
          err,
          "The match couldn't be submitted. Check your connection and try again — your values are kept.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Back from the side step: drop this upload and pick a different photo. */
  async function retake() {
    try {
      await cleanupDraft();
    } catch (err) {
      // Daily server cleanup is the fallback for an abandoned draft.
      logger.warn("snap_cleanup_failed", errorContext(err));
    }
    rematch();
  }

  /** Start over for the next game against the same opponent (also used by retake). */
  function rematch() {
    cancelRequested.current = false;
    activeDraftId.current = null;
    autoTeamRef.current = { my: false, opp: false };
    setDraftId(null);
    setExtraction(null);
    setImageUri(null);
    setError(null);
    setSideChosen(false);
    setMyTeam(null);
    setOpponentTeam(null);
    setMyGoals(0);
    setOpponentGoals(0);
    setMyPossession(null);
    setOpponentPossession(null);
    setMyShots(null);
    setOpponentShots(null);
    setMyShotsOnTarget(null);
    setOpponentShotsOnTarget(null);
    setMyXg(null);
    setOpponentXg(null);
    setMySaves(null);
    setOpponentSaves(null);
    setMyBallRecoveryTime(null);
    setOpponentBallRecoveryTime(null);
    setScoreConfirmed(false);
    setSubmittedMatchId(null);
    setStep("capture");
  }

  return {
    showCameraOption,
    error,
    clearError: () => setError(null),
    step,
    setStep,
    phase,
    imageUri,
    extraction,
    mySide,
    sideChosen,
    chooseSide,
    opponent,
    chooseOpponent,
    players,
    teams,
    me,
    ratingByUid,
    opponentHistory,
    myRecentTeamIds,
    myTeam,
    setMyTeam: (team: Team | null) => {
      autoTeamRef.current.my = false;
      setMyTeam(team);
    },
    opponentTeam,
    setOpponentTeam: (team: Team | null) => {
      autoTeamRef.current.opp = false;
      setOpponentTeam(team);
    },
    teamsPrefilled: Boolean(teamGuesses.my || teamGuesses.opp),
    myGoals,
    setMyGoals,
    opponentGoals,
    setOpponentGoals,
    myPossession,
    setMyPossession,
    opponentPossession,
    setOpponentPossession,
    myShots,
    setMyShots,
    opponentShots,
    setOpponentShots,
    myShotsOnTarget,
    setMyShotsOnTarget,
    opponentShotsOnTarget,
    setOpponentShotsOnTarget,
    myXg,
    setMyXg,
    opponentXg,
    setOpponentXg,
    mySaves,
    setMySaves,
    opponentSaves,
    setOpponentSaves,
    myBallRecoveryTime,
    setMyBallRecoveryTime,
    opponentBallRecoveryTime,
    setOpponentBallRecoveryTime,
    scoreCheck,
    scoreNeedsCheck,
    confirmScore: () => setScoreConfirmed(true),
    applyImpliedScore,
    isSubmitting,
    submittedMatchId,
    myElo,
    opponentElo,
    myDelta,
    opponentDelta,
    handleSelect,
    handleFile,
    handleLeave,
    handleSubmit,
    rematch,
    retake,
    onViewMatch,
    onDone,
  };
}

export type SnapFlowState = ReturnType<typeof useSnapFlow>;
