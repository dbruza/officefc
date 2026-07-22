import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { logger } from "@/lib/logger";
import { uploadMatchPhoto } from "@/lib/upload";
import { pickMatchPhoto } from "@/lib/photoPicker";
import {
  abandonMatchDraft,
  callExtractMatchStats,
  submitAiAssistedMatch,
  previewElo,
  type LeaguePlayer,
  type Team,
} from "@/lib/league";
import type { Player } from "@/types";
import type { ExtractionResult, SnapFlowProps, SnapStep } from "./types";

/** Bounded error fields for logging; `code` picks up UploadError/Firebase error codes. */
function errorContext(err: unknown): { message: string; code: string | null } {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : null;
  return { message: err instanceof Error ? err.message : String(err), code };
}

export function useSnapFlow(props: SnapFlowProps) {
  const { uid, profile, season, players, teams, standings, onCancel, onManualFallback, onDone } =
    props;

  const me: Player = {
    id: uid,
    name: profile.displayName,
    handle: profile.handle,
    jersey: profile.jersey,
    color: profile.color,
    isYou: true,
  };
  const { width } = useWindowDimensions();
  const showCameraOption = Platform.OS !== "web" || width < 768;
  const isWebWide = Platform.OS === "web" && width >= 768;

  const [step, setStep] = useState<SnapStep>("capture");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mySide, setMySide] = useState<"home" | "away">("home");
  const [opponent, setOpponent] = useState<LeaguePlayer | null>(null);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myGoals, setMyGoals] = useState(0);
  const [opponentGoals, setOpponentGoals] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [myPossession, setMyPossession] = useState<number | null>(null);
  const [opponentPossession, setOpponentPossession] = useState<number | null>(null);
  const [myShots, setMyShots] = useState<number | null>(null);
  const [opponentShots, setOpponentShots] = useState<number | null>(null);
  const [myShotsOnTarget, setMyShotsOnTarget] = useState<number | null>(null);
  const [opponentShotsOnTarget, setOpponentShotsOnTarget] = useState<number | null>(null);
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
  }, [mySide, extraction]);

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

  async function handleSelect(source: "camera" | "library") {
    cancelRequested.current = false;
    setError(null);
    try {
      const selected = await pickMatchPhoto(source);
      if (!selected) return;
      await cleanupDraft();
      setExtraction(null);
      setImageUri(selected.uri);
      await handleUpload(selected.uri, selected.mimeType, selected.fileSize);
    } catch (err) {
      logger.error("snap_select_failed", { ...errorContext(err), source });
      setError(err instanceof Error ? err.message : "Could not open that photo.");
      setStep("capture");
    }
  }

  async function handleLeave(destination: "cancel" | "manual") {
    cancelRequested.current = true;
    try {
      await cleanupDraft();
    } catch (err) {
      // Daily server cleanup is the fallback if the browser is offline while leaving.
      logger.warn("snap_cleanup_failed", errorContext(err));
    }
    if (destination === "manual") onManualFallback();
    else onCancel();
  }

  async function handleUpload(uri: string, mimeType?: string, fileSize?: number) {
    setStep("processing");
    setError(null);
    try {
      const upload = await uploadMatchPhoto(uid, uri, mimeType, fileSize);
      activeDraftId.current = upload.draftId;
      setDraftId(upload.draftId);
      if (cancelRequested.current) {
        await cleanupDraft(upload.draftId);
        return;
      }
      await handleExtract(upload.draftId, upload.storagePath);
    } catch (err) {
      logger.error("snap_upload_failed", errorContext(err));
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
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
      setStep("side");
    } catch (err) {
      logger.error("snap_extract_failed", { ...errorContext(err), draftId: id });
      const msg = err instanceof Error ? err.message : "Extraction failed.";
      setError(msg);
      setStep("capture");
    }
  }

  async function handleSubmit() {
    if (!draftId || !season || !opponent || !myTeam || !opponentTeam) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitAiAssistedMatch({
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
        },
      });
      activeDraftId.current = null;
      setStep("done");
    } catch (err) {
      logger.error("snap_submit_failed", { ...errorContext(err), draftId });
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    showCameraOption,
    isWebWide,
    error,
    step,
    setStep,
    imageUri,
    extraction,
    mySide,
    setMySide,
    opponent,
    setOpponent,
    players,
    teams,
    me,
    ratingByUid,
    myTeam,
    setMyTeam,
    opponentTeam,
    setOpponentTeam,
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
    isSubmitting,
    myElo,
    myDelta,
    opponentDelta,
    handleSelect,
    handleLeave,
    handleSubmit,
    onDone,
  };
}

export type SnapFlowState = ReturnType<typeof useSnapFlow>;
