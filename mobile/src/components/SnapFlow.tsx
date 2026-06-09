import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Avatar, Button, Card, EloDelta, Icon, Txt } from "@/components";
import { uploadMatchPhoto } from "@/lib/upload";
import { pickMatchPhoto } from "@/lib/photoPicker";
import {
  abandonMatchDraft,
  callExtractMatchStats,
  submitAiAssistedMatch,
  previewElo,
  type LeaguePlayer,
  type Season,
  type Standing,
  type Team,
} from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Player } from "@/types";

type SnapStep =
  | "capture"
  | "processing"
  | "side"
  | "opponent"
  | "teams"
  | "prefill"
  | "review"
  | "submitting"
  | "done";

interface ExtractionSuggestion {
  home: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    team_name: string | null;
  };
  away: {
    goals: number | null;
    possession: number | null;
    shots: number | null;
    shots_on_target: number | null;
    team_name: string | null;
  };
  homeResult: "W" | "D" | "L" | null;
}

interface ExtractionResult {
  ok: boolean;
  detectedScreen: boolean;
  confidence: number;
  requiresReview: boolean;
  flags: string[];
  suggestion: ExtractionSuggestion | null;
}

interface SnapFlowProps {
  uid: string;
  profile: { displayName: string; handle: string; jersey: number; color: string };
  season: Season;
  players: LeaguePlayer[];
  teams: Team[];
  standings: Standing[];
  onCancel: () => void;
  onManualFallback: () => void;
  onDone: () => void;
}

export function SnapFlow({
  uid,
  profile,
  season,
  players,
  teams,
  standings,
  onCancel,
  onManualFallback,
  onDone,
}: SnapFlowProps) {
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
  const myElo = ratingByUid.get(uid) ?? 1500;
  const opponentElo = ratingByUid.get(opponent?.id ?? "") ?? 1500;
  const myDelta = opponent ? previewElo(myElo, opponentElo, myGoals, opponentGoals) : 0;
  const opponentDelta = opponent ? previewElo(opponentElo, myElo, opponentGoals, myGoals) : 0;

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
      setError(err instanceof Error ? err.message : "Could not open that photo.");
      setStep("capture");
    }
  }

  async function handleLeave(destination: "cancel" | "manual") {
    cancelRequested.current = true;
    try {
      await cleanupDraft();
    } catch {
      // Daily server cleanup is the fallback if the browser is offline while leaving.
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
        setError("This doesn't look like a stats screen. Try a different photo, or log manually.");
        setStep("capture");
        return;
      }
      if (
        ext.suggestion &&
        ext.suggestion.home.goals == null &&
        ext.suggestion.away.goals == null
      ) {
        setError("Couldn't read the score from this image. Try a clearer photo, or log manually.");
        setStep("capture");
        return;
      }
      setStep("side");
    } catch (err) {
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
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Maps the review flags returned by the AI extraction backend to human-readable copy.
  function flagLabel(field: string): string {
    const map: Record<string, string> = {
      low_confidence: "AI confidence is low — please double-check these values",
      home_goals_unreadable: "Home goals could not be read",
      away_goals_unreadable: "Away goals could not be read",
      possession_sum_off: "Possession doesn't add up to ~100%",
      home_sot_gt_shots: "Home shots on target > total shots (clamped)",
      away_sot_gt_shots: "Away shots on target > total shots (clamped)",
    };
    return map[field] || field;
  }

  function statColor(value: unknown, extractedValue: unknown): string {
    if (value !== extractedValue) return colors.accent;
    return colors.text;
  }

  if (step === "capture") {
    return (
      <View style={styles.full}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => void handleLeave("cancel")} style={styles.iconBtn}>
            <Icon name="x" size={20} stroke={2.5} />
          </Pressable>
          <Txt variant="head" size={18}>
            Upload match photo
          </Txt>
        </View>
        <View style={styles.centerContent}>
          <Icon name="camera" size={48} color={colors.textDim} />
          <Txt variant="head" size={20} style={{ marginTop: spacing.lg }}>
            Upload or take a photo
          </Txt>
          <Txt
            color={colors.textDim}
            size={13}
            style={{
              marginTop: spacing.sm,
              textAlign: "center",
              paddingHorizontal: spacing.x2,
              lineHeight: 19,
            }}
          >
            Use the full-time stats screen. AI Beta will suggest the score and key stats, but you
            must verify every value.
          </Txt>
          <View
            style={{
              gap: spacing.md,
              marginTop: spacing.x2,
              width: "100%",
              paddingHorizontal: spacing.x2,
            }}
          >
            {showCameraOption ? (
              <Button full size="lg" icon="camera" onPress={() => void handleSelect("camera")}>
                Take a photo
              </Button>
            ) : null}
            <Button
              full
              size="lg"
              variant={showCameraOption ? "dark" : "primary"}
              icon="photo"
              onPress={() => void handleSelect("library")}
            >
              {Platform.OS === "web" && width >= 768 ? "Choose image file" : "Choose from library"}
            </Button>
            <Button
              full
              size="md"
              variant="ghost"
              icon="edit"
              onPress={() => void handleLeave("manual")}
            >
              Enter score manually
            </Button>
          </View>
          <View style={styles.privacyNotice}>
            <Txt size={11.5} color={colors.textDim} style={{ textAlign: "center", lineHeight: 17 }}>
              Photos stay private. Anthropic processes the image for extraction. League members can
              view submitted photos through temporary links, submitters can delete them, and
              abandoned drafts are deleted after 24 hours.
            </Txt>
          </View>
          {error ? (
            <Txt
              color={colors.loss}
              size={13}
              style={{ marginTop: spacing.lg, textAlign: "center" }}
            >
              {error}
            </Txt>
          ) : null}
        </View>
      </View>
    );
  }

  if (step === "processing") {
    return (
      <View style={styles.full}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => void handleLeave("cancel")} style={styles.iconBtn}>
            <Icon name="x" size={20} stroke={2.5} />
          </Pressable>
          <Txt variant="head" size={18}>
            Processing
          </Txt>
        </View>
        <View style={styles.centerContent}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
          <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: spacing.x2 }} />
          <Txt color={colors.textDim} size={13} style={{ marginTop: spacing.md }}>
            Uploading and analyzing the stats screen…
          </Txt>
        </View>
      </View>
    );
  }

  if (step === "side") {
    return (
      <View style={styles.full}>
        <ProgressBar current={0} total={4} label="Which side were you?" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
            Which side were you on?
          </Txt>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.smallPreview} resizeMode="contain" />
          ) : null}
          <Txt
            color={colors.textDim}
            size={12.5}
            style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}
          >
            The AI reads left=home, right=away. Choose your side so we map the goals correctly.
          </Txt>
          <View style={{ gap: spacing.sm }}>
            <Pressable
              onPress={() => {
                setMySide("home");
                setStep("opponent");
              }}
              style={[styles.optionCard, mySide === "home" && styles.optionActive]}
            >
              <Icon
                name="bolt"
                size={20}
                color={mySide === "home" ? colors.accent : colors.textDim}
              />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMedium" size={14.5}>
                  I was the Home team (left side)
                </Txt>
                <Txt size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                  {extraction?.suggestion?.home?.goals != null
                    ? `Goals read: ${extraction.suggestion.home.goals}`
                    : "Goals unreadable"}
                </Txt>
              </View>
              <Icon name="chevron" size={14} color={colors.textDim} />
            </Pressable>
            <Pressable
              onPress={() => {
                setMySide("away");
                setStep("opponent");
              }}
              style={[styles.optionCard, mySide === "away" && styles.optionActive]}
            >
              <Icon
                name="bolt"
                size={20}
                color={mySide === "away" ? colors.accent : colors.textDim}
              />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMedium" size={14.5}>
                  I was the Away team (right side)
                </Txt>
                <Txt size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                  {extraction?.suggestion?.away?.goals != null
                    ? `Goals read: ${extraction.suggestion.away.goals}`
                    : "Goals unreadable"}
                </Txt>
              </View>
              <Icon name="chevron" size={14} color={colors.textDim} />
            </Pressable>
          </View>
        </ScrollView>
        <FlowFooter onBack={() => void handleLeave("cancel")} onSkip={() => {}} hideNext />
      </View>
    );
  }

  if (step === "opponent") {
    return (
      <View style={styles.full}>
        <ProgressBar current={1} total={4} label="Opponent" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
            Who did you play?
          </Txt>
          <View style={{ gap: spacing.sm }}>
            {players.map((player) => (
              <Pressable
                key={player.id}
                onPress={() => {
                  setOpponent(player);
                  setStep("teams");
                }}
                style={[styles.pickRow, opponent?.id === player.id && styles.pickRowActive]}
              >
                <Avatar player={player} size={42} jersey />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMedium" size={14.5}>
                    {player.name}
                  </Txt>
                  <Txt variant="mono" size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                    ELO {ratingByUid.get(player.id) ?? 1500} · @{player.handle}
                  </Txt>
                </View>
                {opponent?.id === player.id ? (
                  <View style={styles.check}>
                    <Icon name="check" size={13} color={colors.onAccent} stroke={3} />
                  </View>
                ) : null}
              </Pressable>
            ))}
            {players.length === 0 ? (
              <Txt color={colors.textDim}>Invite another player before logging a match.</Txt>
            ) : null}
          </View>
        </ScrollView>
        <FlowFooter onBack={() => setStep("side")} onSkip={() => {}} hideNext />
      </View>
    );
  }

  if (step === "teams") {
    return (
      <View style={styles.full}>
        <ProgressBar current={2} total={4} label="Teams" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
            Which teams did you use?
          </Txt>
          <TeamPicker
            label="Your team"
            player={me}
            teams={teams}
            value={myTeam}
            onChange={(t) => {
              setMyTeam(t);
              if (opponentTeam) setStep("prefill");
            }}
          />
          <View style={{ height: spacing.lg }} />
          <TeamPicker
            label={`${opponent?.name?.split(" ")[0] ?? "Opponent"}'s team`}
            player={opponent}
            teams={teams}
            value={opponentTeam}
            onChange={(t) => {
              setOpponentTeam(t);
              if (myTeam) setStep("prefill");
            }}
          />
        </ScrollView>
        <FlowFooter
          onBack={() => setStep("opponent")}
          onSkip={() => (myTeam && opponentTeam ? setStep("prefill") : null)}
          nextDisabled={!myTeam || !opponentTeam}
        />
      </View>
    );
  }

  if (step === "prefill") {
    const s = extraction?.suggestion;
    const conf = extraction?.confidence ?? 0;
    const confLabel =
      conf >= 0.8 ? "High confidence" : conf >= 0.6 ? "Review needed" : "Low confidence";

    return (
      <View style={styles.full}>
        <ProgressBar current={3} total={4} label="Verify stats" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Txt variant="head" size={22} style={{ marginBottom: spacing.sm }}>
            Verify the score and stats
          </Txt>
          <Txt size={12.5} color={colors.textDim} style={{ lineHeight: 18 }}>
            AI Beta can be wrong. Check every value against the photo before continuing.
          </Txt>
          <View style={styles.confBadge}>
            <Icon name="bolt" size={14} color={conf >= 0.8 ? colors.accent : colors.draw} />
            <Txt size={12} color={conf >= 0.8 ? colors.accent : colors.draw}>
              {confLabel} ({(conf * 100).toFixed(0)}%)
            </Txt>
          </View>

          {extraction?.flags?.length ? (
            <View style={styles.flagBox}>
              {extraction.flags.map((f) => (
                <Txt key={f} size={11.5} color={colors.draw} style={{ lineHeight: 18 }}>
                  <Txt size={11.5} color={colors.accent}>
                    !
                  </Txt>{" "}
                  {flagLabel(f)}
                </Txt>
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            <Txt
              variant="head"
              size={11}
              color={colors.textDim}
              style={{ marginBottom: spacing.sm }}
            >
              SCORE
            </Txt>
            <View style={styles.scoreRow}>
              <ScoreBox
                label="You"
                value={myGoals}
                color={statColor(myGoals, mySide === "home" ? s?.home?.goals : s?.away?.goals)}
                onChange={setMyGoals}
              />
              <Txt variant="monoBold" size={28} color={colors.textFaint}>
                :
              </Txt>
              <ScoreBox
                label={opponent?.name?.split(" ")[0] ?? "Opp"}
                value={opponentGoals}
                color={statColor(
                  opponentGoals,
                  mySide === "home" ? s?.away?.goals : s?.home?.goals,
                )}
                onChange={setOpponentGoals}
              />
            </View>
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <Txt
              variant="head"
              size={11}
              color={colors.textDim}
              style={{ marginBottom: spacing.sm }}
            >
              KEY STATS
            </Txt>
            <View style={{ gap: spacing.sm }}>
              <StatEditRow
                label="Possession %"
                myValue={myPossession}
                oppValue={opponentPossession}
                onChangeMy={setMyPossession}
                onChangeOpp={setOpponentPossession}
              />
              <StatEditRow
                label="Total Shots"
                myValue={myShots}
                oppValue={opponentShots}
                onChangeMy={setMyShots}
                onChangeOpp={setOpponentShots}
              />
              <StatEditRow
                label="Shots on Target"
                myValue={myShotsOnTarget}
                oppValue={opponentShotsOnTarget}
                onChangeMy={setMyShotsOnTarget}
                onChangeOpp={setOpponentShotsOnTarget}
              />
            </View>
          </View>
        </ScrollView>
        <FlowFooter
          onBack={() => setStep("teams")}
          onSkip={() => setStep("review")}
          nextLabel="Review"
        />
      </View>
    );
  }

  if (step === "review") {
    return (
      <View style={styles.full}>
        <ProgressBar current={4} total={4} label="Review" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
            Look right?
          </Txt>

          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.reviewImage} resizeMode="contain" />
          ) : null}

          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.reviewScore}>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Avatar player={me} size={44} jersey />
                <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }}>
                  You
                </Txt>
                <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
                  {myTeam?.name ?? ""}
                </Txt>
              </View>
              <Txt variant="monoBold" size={38}>
                {myGoals}
                <Txt variant="monoBold" size={38} color={colors.textFaint}>
                  :
                </Txt>
                {opponentGoals}
              </Txt>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Avatar player={opponent ?? undefined} size={44} jersey />
                <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }}>
                  {opponent?.name?.split(" ")[0] ?? "Opp"}
                </Txt>
                <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
                  {opponentTeam?.name ?? ""}
                </Txt>
              </View>
            </View>

            {myPossession != null || opponentPossession != null || myShots != null ? (
              <>
                <View style={styles.divider} />
                <View style={styles.statsGrid}>
                  {(myPossession ?? opponentPossession) != null ? (
                    <View style={styles.statPair}>
                      <Txt size={11} color={colors.textDim}>
                        POSSESSION
                      </Txt>
                      <Txt variant="mono" size={13}>
                        {myPossession ?? "-"}% / {opponentPossession ?? "-"}%
                      </Txt>
                    </View>
                  ) : null}
                  {(myShots ?? opponentShots) != null ? (
                    <View style={styles.statPair}>
                      <Txt size={11} color={colors.textDim}>
                        SHOTS
                      </Txt>
                      <Txt variant="mono" size={13}>
                        {myShots ?? "-"} / {opponentShots ?? "-"}
                      </Txt>
                    </View>
                  ) : null}
                  {(myShotsOnTarget ?? opponentShotsOnTarget) != null ? (
                    <View style={styles.statPair}>
                      <Txt size={11} color={colors.textDim}>
                        ON TARGET
                      </Txt>
                      <Txt variant="mono" size={13}>
                        {myShotsOnTarget ?? "-"} / {opponentShotsOnTarget ?? "-"}
                      </Txt>
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}

            <View style={styles.divider} />
            <View style={styles.reviewBottom}>
              <View>
                <Txt variant="head" size={10.5} color={colors.textDim}>
                  ELO CHANGE
                </Txt>
                <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 3 }}>
                  Applies after opponent confirmation
                </Txt>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <EloDelta delta={myDelta} />
                <Txt variant="mono" size={11} color={colors.textDim} style={{ marginTop: 3 }}>
                  opponent {opponentDelta >= 0 ? "+" : ""}
                  {opponentDelta}
                </Txt>
              </View>
            </View>
          </Card>

          <View style={styles.sourceTag}>
            <Icon name="bolt" size={12} color={colors.accent} />
            <Txt size={11} color={colors.textDim}>
              AI-assisted · {mySide === "home" ? "Home" : "Away"} side
            </Txt>
          </View>
        </ScrollView>
        <FlowFooter
          onBack={() => setStep("prefill")}
          onSkip={handleSubmit}
          nextLabel="Submit match"
          nextDisabled={false}
          loading={isSubmitting}
        />
      </View>
    );
  }

  if (step === "done") {
    return (
      <View style={styles.full}>
        <View style={styles.centerContent}>
          <View style={[styles.resultBurst, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
            <Icon name="check" size={38} color={colors.accent} />
          </View>
          <Txt variant="head" size={26} style={{ textAlign: "center", marginTop: spacing.lg }}>
            Result sent for confirmation.
          </Txt>
          <Txt variant="monoBold" size={56} style={{ marginVertical: spacing.sm }}>
            {myGoals}
            <Txt variant="monoBold" size={56} color={colors.textFaint}>
              :
            </Txt>
            {opponentGoals}
          </Txt>
          <Txt color={colors.textDim} style={{ textAlign: "center", lineHeight: 20 }}>
            {opponent?.name?.split(" ")[0] ?? "Opponent"} needs to confirm before this affects the
            table.
          </Txt>
          <Card
            style={{
              marginTop: spacing.x2,
              width: "100%",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View>
              <Txt variant="head" size={10.5} color={colors.textDim}>
                ELO PREVIEW
              </Txt>
              <Txt variant="monoBold" size={19} style={{ marginTop: 4 }}>
                {myElo + myDelta} <EloDelta delta={myDelta} />
              </Txt>
            </View>
            <Txt size={12} color={colors.textFaint}>
              pending
            </Txt>
          </Card>
          {error ? (
            <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
              {error}
            </Txt>
          ) : null}
        </View>
        <View style={styles.footer}>
          <Button full size="lg" onPress={onDone}>
            Back to dashboard
          </Button>
        </View>
      </View>
    );
  }

  return null;
}

function ProgressBar({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <View>
      <View style={styles.progressHeader}>
        <Txt size={11.5} color={colors.textDim}>
          Step {current + 1} of {total} · {label}
        </Txt>
      </View>
      <View style={styles.track}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[styles.trackSeg, i <= current && styles.trackSegOn]} />
        ))}
      </View>
    </View>
  );
}

function FlowFooter({
  onBack,
  onSkip,
  nextLabel = "Continue",
  nextDisabled,
  hideNext,
  loading,
}: {
  onBack: () => void;
  onSkip: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideNext?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.footer}>
      <Button variant="dark" size="md" icon="back" onPress={onBack}>
        Back
      </Button>
      {!hideNext ? (
        <Button
          size="md"
          icon={nextLabel === "Submit match" ? "check" : undefined}
          onPress={() => onSkip()}
          disabled={nextDisabled || loading}
        >
          {loading ? "Submitting…" : nextLabel}
        </Button>
      ) : null}
    </View>
  );
}

function ScoreBox({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Txt size={11} color={colors.textDim} numberOfLines={1}>
        {label}
      </Txt>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          style={[styles.stepBtn, value === 0 && { opacity: 0.35 }]}
        >
          <Txt variant="monoBold" size={22}>
            -
          </Txt>
        </Pressable>
        <Txt
          variant="monoBold"
          size={34}
          color={color}
          style={{ minWidth: 44, textAlign: "center" }}
        >
          {value}
        </Txt>
        <Pressable onPress={() => onChange(Math.min(99, value + 1))} style={styles.stepBtn}>
          <Txt variant="monoBold" size={22}>
            +
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

function StatEditRow({
  label,
  myValue,
  oppValue,
  onChangeMy,
  onChangeOpp,
}: {
  label: string;
  myValue: number | null;
  oppValue: number | null;
  onChangeMy: (v: number | null) => void;
  onChangeOpp: (v: number | null) => void;
}) {
  return (
    <View style={styles.statEditRow}>
      <Txt size={12} color={colors.textDim} style={{ width: 110 }}>
        {label}
      </Txt>
      <View style={styles.statEditFields}>
        <TextInput
          value={myValue != null ? String(myValue) : ""}
          onChangeText={(t) => onChangeMy(t ? Number(t) || null : null)}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          keyboardType="numeric"
          style={styles.statInput}
        />
        <Txt size={12} color={colors.textFaint}>
          vs
        </Txt>
        <TextInput
          value={oppValue != null ? String(oppValue) : ""}
          onChangeText={(t) => onChangeOpp(t ? Number(t) || null : null)}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          keyboardType="numeric"
          style={styles.statInput}
        />
      </View>
    </View>
  );
}

function TeamPicker({
  label,
  player,
  teams,
  value,
  onChange,
}: {
  label: string;
  player: Player | null;
  teams: Team[];
  value: Team | null;
  onChange: (team: Team) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <View>
      <View style={styles.fieldLabel}>
        <Avatar player={player} size={20} />
        <Txt variant="head" size={11} color={colors.textDim}>
          {label.toUpperCase()}
        </Txt>
      </View>
      <Pressable
        onPress={() => setOpen((c) => !c)}
        style={[styles.teamField, value && styles.teamFieldFilled]}
      >
        <Icon name="jersey" size={17} color={value ? player?.color : colors.textDim} />
        <Txt color={value ? colors.text : colors.textDim} style={{ flex: 1 }}>
          {value?.name ?? "Search teams…"}
        </Txt>
        <Icon name={open ? "up" : "search"} size={16} color={colors.textDim} />
      </Pressable>
      {open ? (
        <View style={styles.teamPopover}>
          <View style={styles.searchBox}>
            <Icon name="search" size={15} color={colors.textDim} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Type a team name"
              placeholderTextColor={colors.textFaint}
              autoFocus
              style={styles.searchInput}
            />
          </View>
          <View style={{ gap: 4 }}>
            {filtered.map((team) => (
              <Pressable
                key={team.id}
                onPress={() => {
                  onChange(team);
                  setOpen(false);
                  setSearch("");
                }}
                style={[styles.teamOption, value?.id === team.id && styles.teamOptionActive]}
              >
                <Icon name="jersey" size={15} color={colors.textDim} />
                <Txt size={13.5} style={{ flex: 1 }}>
                  {team.name}
                </Txt>
                {value?.id === team.id ? (
                  <Icon name="check" size={14} color={colors.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.x2,
  },
  privacyNotice: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.x2,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  smallPreview: {
    width: "100%",
    height: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  reviewImage: {
    width: "100%",
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    marginBottom: spacing.sm,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  optionActive: {
    borderColor: withAlpha(colors.accent, 0.55),
    backgroundColor: withAlpha(colors.accent, 0.07),
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pickRowActive: {
    borderColor: withAlpha(colors.accent, 0.55),
    backgroundColor: withAlpha(colors.accent, 0.07),
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  confBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: withAlpha(colors.accent, 0.08),
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
  flagBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: withAlpha(colors.draw, 0.08),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(colors.draw, 0.2),
  },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  statEditRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statEditFields: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13.5,
    fontFamily: "JetBrainsMono_500Medium",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    textAlign: "center",
  },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statPair: { flex: 1, minWidth: 100, gap: 4 },
  reviewScore: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  reviewBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sourceTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: "center",
  },
  resultBurst: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  progressHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  track: { flexDirection: "row", gap: 5, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  trackSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surface2 },
  trackSegOn: { backgroundColor: colors.accent },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  fieldLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  teamField: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  teamFieldFilled: { borderColor: withAlpha(colors.accent, 0.35) },
  teamPopover: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13.5, paddingVertical: 10 },
  teamOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  teamOptionActive: { backgroundColor: withAlpha(colors.accent, 0.08) },
});
