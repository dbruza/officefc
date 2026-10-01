/**
 * Photo-flow screens. Each step is a `Page` with the shared header/progress and a pinned
 * footer; from desktop width the uploaded photo sits in a sticky left pane so every value
 * can be checked against it (phones get a tap-to-zoom thumbnail instead).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Platform, ScrollView, View } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
// Primitives by path, not the barrel: the barrel re-exports SnapFlow (require cycle).
import { Avatar } from "../Avatar";
import { Button } from "../Button";
import { Card } from "../Card";
import { Icon } from "../Icon";
import { Interactive } from "../Interactive";
import { Columns, Page } from "../Page";
import { StickySplit } from "../StickySplit";
import { TeamPicker } from "../TeamPicker";
import { Txt } from "../Txt";
import { ErrorCard, Tag } from "../feedback";
import { Reveal } from "../motion";
import { EloLine, MatchSubmitted } from "../MatchSubmitted";
import { OpponentPicker } from "../OpponentPicker";
import { PhotoThumb } from "../PhotoLightbox";
import { ScoreStepper } from "../ScoreStepper";
import { colors, spacing } from "@/theme";
import { firstName } from "@/lib/format";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import { FlowFooter, SnapHeader, StatEditRow } from "./parts";
import { flagLabel, statColor } from "./helpers";
import { styles } from "./styles";
import type { SnapFlowState } from "./useSnapFlow";
import type { SnapPhase } from "./types";

type Flow = { flow: SnapFlowState };

/** Page chrome for the post-upload steps: header + progress, photo pane on desktop. */
function StepPage({
  flow,
  progress,
  footer,
  children,
}: Flow & { progress: number; footer: ReactNode; children: ReactNode }) {
  const { isDesktop } = useBreakpoint();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [progress]);
  const body = (
    <Reveal key={progress} from="left" duration={280}>
      {children}
    </Reveal>
  );
  return (
    <Page
      header={<SnapHeader onClose={() => void flow.handleLeave("cancel")} progress={progress} />}
      footer={footer}
      width="default"
      scrollRef={scrollRef}
    >
      <StickySplit
        asideSide="left"
        ratio={[3, 2]}
        main={body}
        aside={
          isDesktop && flow.imageUri ? (
            <>
              <PhotoThumb uri={flow.imageUri} maxHeight={560} label="Your stats photo" />
              <View style={styles.sourceTag}>
                <Icon name="sparkle" size={13} color={colors.accent} />
                <Txt size={11.5} color={colors.textDim}>
                  AI Beta read this photo — click it to zoom
                </Txt>
              </View>
            </>
          ) : null
        }
      />
    </Page>
  );
}

/** Phones: the photo as a tap-to-zoom thumbnail at the top of a step. */
function PhoneThumb({ flow, maxHeight = 170 }: Flow & { maxHeight?: number }) {
  const { isDesktop } = useBreakpoint();
  if (isDesktop || !flow.imageUri) return null;
  return (
    <View style={styles.phoneThumb}>
      <PhotoThumb uri={flow.imageUri} maxHeight={maxHeight} label="Your stats photo" />
    </View>
  );
}

function StepTitle({ children }: { children: string }) {
  return (
    <Txt variant="head" size={22} style={styles.stepTitle} accessibilityRole="header">
      {children}
    </Txt>
  );
}

/**
 * Web: accept an image dropped anywhere on the page or pasted (⌘V / Ctrl+V) while the
 * capture step is up. Window-level so the whole screen is the target, not a small box.
 */
function useDropAndPaste(onFile: (file: File) => void, setDragging: (on: boolean) => void) {
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) onFileRef.current(file);
    };
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      const file =
        data?.files?.[0] ??
        Array.from(data?.items ?? [])
          .find((item) => item.kind === "file" && item.type.startsWith("image/"))
          ?.getAsFile() ??
        null;
      // Plain text pastes (e.g. into a field elsewhere) are left alone.
      if (!file) return;
      event.preventDefault();
      onFileRef.current(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [setDragging]);
}

const IS_MAC =
  Platform.OS === "web" && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function CaptureStep({ flow, modeSwitch }: Flow & { modeSwitch?: ReactNode }) {
  const { isDesktop, isWeb } = useBreakpoint();
  const [dragging, setDragging] = useState(false);
  useDropAndPaste((file) => void flow.handleFile(file), setDragging);
  // Pointer-first web (desktop/laptop): a drop zone is the natural target.
  const dropFirst = isWeb && !flow.showCameraOption;

  const privacy = (
    <View style={styles.privacyNotice}>
      <Icon name="shield" size={16} color={colors.textDim} />
      <Txt size={11.5} color={colors.textDim} style={{ flex: 1, lineHeight: 17 }}>
        To read the stats, the image is sent through OpenRouter to Meta's Muse Spark model. League
        members can view submitted photos through temporary links, submitters can delete them, and
        abandoned drafts are deleted after 24 hours.
      </Txt>
    </View>
  );

  const errorBanner = flow.error ? (
    <Reveal from="fade" style={{ marginTop: spacing.lg }}>
      <ErrorCard message={flow.error} />
    </Reveal>
  ) : null;

  const header = (
    <SnapHeader onClose={() => void flow.handleLeave("cancel")}>
      {modeSwitch ? <View style={styles.modeSwitch}>{modeSwitch}</View> : null}
    </SnapHeader>
  );

  if (dropFirst) {
    return (
      <Page header={header} width="default">
        <Columns at="desktop" ratio={[3, 2]} gap={spacing.x3}>
          <Reveal>
            <Interactive
              onPress={() => void flow.handleSelect("library")}
              accessibilityLabel="Choose a stats screenshot to upload"
              pressScale={0.995}
              style={[styles.dropZone, dragging && styles.dropZoneActive]}
              hoverStyle={dragging ? undefined : { borderColor: colors.textFaint }}
            >
              <View style={styles.captureIcon}>
                <Icon name={dragging ? "download" : "upload"} size={30} color={colors.accent} />
              </View>
              <Txt variant="head" size={20} style={{ textAlign: "center" }}>
                {dragging ? "Drop to upload" : "Drop your stats screenshot here"}
              </Txt>
              <Txt size={13} color={colors.textDim} style={{ textAlign: "center", lineHeight: 19 }}>
                or paste it with{" "}
                <Txt variant="monoBold" size={12} color={colors.text}>
                  {IS_MAC ? "⌘V" : "Ctrl+V"}
                </Txt>{" "}
                · JPEG, PNG or WebP
              </Txt>
              {/* Looks like a button, but the whole zone is the button — no nesting. */}
              <View style={styles.fakeButton}>
                <Icon name="photo" size={18} stroke={2.4} color={colors.onAccent} />
                <Txt variant="head" size={15} color={colors.onAccent}>
                  Choose image file
                </Txt>
              </View>
            </Interactive>
            {errorBanner}
          </Reveal>
          <Reveal delay={80}>
            <Txt variant="head" size={16}>
              How it works
            </Txt>
            <View style={{ gap: spacing.md, marginTop: spacing.md }}>
              {[
                ["photo", "Use the full-time stats screen (a screenshot or a photo of the TV)."],
                ["sparkle", "AI Beta reads the score, teams, possession, shots and xG."],
                [
                  "check",
                  "You check every value against the photo, then send it to your opponent.",
                ],
              ].map(([icon, text]) => (
                <View key={text} style={{ flexDirection: "row", gap: spacing.md }}>
                  <Icon name={icon as "photo"} size={18} color={colors.accent} />
                  <Txt size={13} color={colors.textDim} style={{ flex: 1, lineHeight: 19 }}>
                    {text}
                  </Txt>
                </View>
              ))}
            </View>
            {privacy}
            <Button
              variant="ghost"
              icon="edit"
              onPress={() => void flow.handleLeave("manual")}
              style={{ marginTop: spacing.lg }}
            >
              Enter the score manually instead
            </Button>
          </Reveal>
        </Columns>
      </Page>
    );
  }

  return (
    <Page header={header} width="narrow">
      <Reveal style={styles.captureHero}>
        <View style={styles.captureIcon}>
          <Icon name="camera" size={30} color={colors.accent} />
        </View>
        <Txt variant="head" size={isDesktop ? 24 : 21} style={{ marginTop: spacing.lg }}>
          Snap the stats screen
        </Txt>
        <Txt
          color={colors.textDim}
          size={13}
          style={{ marginTop: spacing.sm, textAlign: "center", lineHeight: 19, maxWidth: 380 }}
        >
          Use the full-time stats screen. AI Beta suggests the score and key stats — you verify
          every value before it's sent.
        </Txt>
      </Reveal>
      <Reveal delay={80} style={[styles.captureActions, { marginTop: spacing.x2 }]}>
        {flow.showCameraOption ? (
          <Button full size="lg" icon="camera" onPress={() => void flow.handleSelect("camera")}>
            Take a photo
          </Button>
        ) : null}
        <Button
          full
          size="lg"
          variant={flow.showCameraOption ? "dark" : "primary"}
          icon="photo"
          onPress={() => void flow.handleSelect("library")}
        >
          Choose from library
        </Button>
        <Button
          full
          size="md"
          variant="ghost"
          icon="edit"
          onPress={() => void flow.handleLeave("manual")}
        >
          Enter score manually
        </Button>
        {errorBanner}
        {privacy}
      </Reveal>
    </Page>
  );
}

const SCAN_TRAVEL = 260;
const SCAN: CSSAnimationKeyframes = {
  from: { transform: [{ translateY: -46 }] },
  to: { transform: [{ translateY: SCAN_TRAVEL }] },
};

const STAGES: Array<{ phase: SnapPhase; label: string }> = [
  { phase: "uploading", label: "Uploading photo" },
  { phase: "reading", label: "Reading the stats" },
  { phase: "matching", label: "Matching teams" },
];

export function ProcessingStep({ flow }: Flow) {
  const reduced = useReducedMotion();
  const current = STAGES.findIndex((stage) => stage.phase === flow.phase);
  return (
    <Page header={<SnapHeader onClose={() => void flow.handleLeave("cancel")} />} width="narrow">
      <Reveal from="scale" style={{ marginTop: spacing.lg }}>
        <View style={styles.scanFrame}>
          {flow.imageUri ? (
            <Image source={{ uri: flow.imageUri }} style={styles.scanImage} resizeMode="contain" />
          ) : null}
          {reduced ? null : (
            <Animated.View
              pointerEvents="none"
              style={{
                ...styles.scanLine,
                animationName: SCAN,
                animationDuration: 1700,
                animationIterationCount: "infinite",
                animationDirection: "alternate",
                animationTimingFunction: "ease-in-out",
              }}
            >
              <Svg width="100%" height="100%" style={{ position: "absolute" }}>
                <Defs>
                  <LinearGradient id="snap-scan" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.accent} stopOpacity={0} />
                    <Stop offset="1" stopColor={colors.accent} stopOpacity={0.28} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#snap-scan)" />
              </Svg>
              <View
                style={[
                  styles.scanBeam,
                  { backgroundColor: colors.accent },
                  webStyle({ boxShadow: `0 0 12px ${colors.accent}` }),
                ]}
              />
            </Animated.View>
          )}
        </View>
      </Reveal>
      <View style={styles.checklist} accessibilityLiveRegion="polite">
        {STAGES.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <Reveal key={stage.phase} index={index} delay={120} style={styles.checkRow}>
              <View
                style={[
                  styles.checkDot,
                  done && styles.checkDotDone,
                  active && styles.checkDotActive,
                ]}
              >
                {done ? (
                  <Reveal from="scale" duration={200}>
                    <Icon name="check" size={14} color={colors.onAccent} stroke={3} />
                  </Reveal>
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : null}
              </View>
              <Txt
                variant={active ? "bodyMedium" : "body"}
                size={14}
                color={done ? colors.text : active ? colors.text : colors.textFaint}
              >
                {stage.label}
                {active ? "…" : ""}
              </Txt>
            </Reveal>
          );
        })}
      </View>
      <Txt
        size={12}
        color={colors.textFaint}
        style={{ textAlign: "center", marginTop: spacing.x2 }}
      >
        Usually takes 5–15 seconds.
      </Txt>
    </Page>
  );
}

export function SideStep({ flow }: Flow) {
  const s = flow.extraction?.suggestion;
  const sides = [
    { side: "home" as const, data: s?.home, where: "Left side", badge: "L" },
    { side: "away" as const, data: s?.away, where: "Right side", badge: "R" },
  ];
  return (
    <StepPage
      flow={flow}
      progress={0}
      footer={<FlowFooter onBack={() => void flow.retake()} backLabel="New photo" />}
    >
      <StepTitle>Which side were you?</StepTitle>
      <Txt color={colors.textDim} size={13} style={styles.lede}>
        The stats screen lists the home team on the left. Pick yours so the goals and stats map to
        the right player.
      </Txt>
      <PhoneThumb flow={flow} />
      <View style={{ gap: spacing.sm }}>
        {sides.map(({ side, data, where, badge }, index) => {
          const selected = flow.sideChosen && flow.mySide === side;
          const goals = data?.goals;
          return (
            <Reveal key={side} index={index}>
              <Interactive
                onPress={() => flow.chooseSide(side)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                lift
                style={[styles.optionCard, selected && styles.optionActive]}
                hoverStyle={selected ? undefined : { borderColor: colors.lineStrong }}
              >
                <View style={styles.sideBadge}>
                  <Txt variant="monoBold" size={15} color={colors.textDim}>
                    {badge}
                  </Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyMedium" size={15} numberOfLines={1}>
                    {data?.team_name ? `I was ${data.team_name}` : `I was the ${side} team`}
                  </Txt>
                  <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }}>
                    {where} ·{" "}
                    {goals != null
                      ? `${goals} ${goals === 1 ? "goal" : "goals"}`
                      : "goals unreadable"}
                  </Txt>
                </View>
                {goals != null ? (
                  <Txt variant="monoBold" size={26} color={selected ? colors.accent : colors.text}>
                    {goals}
                  </Txt>
                ) : null}
                <Icon name="chevron" size={14} color={colors.textDim} />
              </Interactive>
            </Reveal>
          );
        })}
      </View>
    </StepPage>
  );
}

export function OpponentStep({ flow }: Flow) {
  return (
    <StepPage flow={flow} progress={1} footer={<FlowFooter onBack={() => flow.setStep("side")} />}>
      <StepTitle>Who did you play?</StepTitle>
      <View style={{ height: spacing.sm }} />
      <OpponentPicker
        players={flow.players}
        ratingByUid={flow.ratingByUid}
        history={flow.opponentHistory}
        selectedId={flow.opponent?.id ?? null}
        onSelect={flow.chooseOpponent}
      />
    </StepPage>
  );
}

export function TeamsStep({ flow }: Flow) {
  const s = flow.extraction?.suggestion;
  const mine = flow.mySide === "home" ? s?.home : s?.away;
  const theirs = flow.mySide === "home" ? s?.away : s?.home;
  const oppFirst = flow.opponent ? firstName(flow.opponent.name) : "Opponent";
  const opponentRecent = flow.opponent
    ? flow.opponentHistory?.get(flow.opponent.id)?.teamIds
    : undefined;
  // Only jump ahead when nothing was pre-picked; otherwise changing one team would skip
  // the check of the other.
  const maybeAdvance = (otherSet: boolean) => {
    if (!flow.teamsPrefilled && otherSet) flow.setStep("verify");
  };
  return (
    <StepPage
      flow={flow}
      progress={2}
      footer={
        <FlowFooter
          onBack={() => flow.setStep("opponent")}
          onNext={() => flow.setStep("verify")}
          nextDisabled={!flow.myTeam || !flow.opponentTeam}
        />
      }
    >
      <StepTitle>Which teams did you use?</StepTitle>
      {flow.teamsPrefilled ? (
        <View style={styles.prefillHint}>
          <Icon name="sparkle" size={13} color={colors.accent} />
          <Txt size={12} color={colors.textDim} style={{ flex: 1, lineHeight: 17 }}>
            Pre-picked from the team names on your photo — double-check both.
          </Txt>
        </View>
      ) : (
        <View style={{ height: spacing.md }} />
      )}
      <Columns at="tablet" gap={spacing.lg}>
        <TeamPicker
          label="Your team"
          player={flow.me}
          teams={flow.teams}
          value={flow.myTeam}
          onChange={(team) => {
            flow.setMyTeam(team);
            maybeAdvance(!!flow.opponentTeam);
          }}
          recentTeamIds={flow.myRecentTeamIds}
          hint={mine?.team_name ? `Photo: ${mine.team_name}` : undefined}
        />
        <TeamPicker
          label={`${oppFirst}'s team`}
          player={flow.opponent}
          teams={flow.teams}
          value={flow.opponentTeam}
          onChange={(team) => {
            flow.setOpponentTeam(team);
            maybeAdvance(!!flow.myTeam);
          }}
          recentTeamIds={opponentRecent}
          hint={theirs?.team_name ? `Photo: ${theirs.team_name}` : undefined}
        />
      </Columns>
    </StepPage>
  );
}

export function VerifyStep({ flow }: Flow) {
  const { isTablet } = useBreakpoint();
  const s = flow.extraction?.suggestion;
  const conf = flow.extraction?.confidence ?? 0;
  const confLabel =
    conf >= 0.8 ? "High confidence" : conf >= 0.6 ? "Review needed" : "Low confidence";
  const mine = flow.mySide === "home" ? s?.home : s?.away;
  const theirs = flow.mySide === "home" ? s?.away : s?.home;
  const oppFirst = flow.opponent ? firstName(flow.opponent.name) : "Opponent";
  const editing = () => flow.clearError();
  // Any edit clears a stale submit error — the next attempt may well succeed.
  const edit =
    (set: (value: number | null) => void) =>
    (value: number | null): void => {
      editing();
      set(value);
    };

  return (
    <StepPage
      flow={flow}
      progress={3}
      footer={
        <FlowFooter
          onBack={() => flow.setStep("teams")}
          onNext={() => void flow.handleSubmit()}
          nextLabel="Submit match"
          loading={flow.isSubmitting}
          error={flow.error}
          onRetry={() => void flow.handleSubmit()}
        />
      }
    >
      <StepTitle>Check the score and stats</StepTitle>
      <Txt size={13} color={colors.textDim} style={{ lineHeight: 19 }}>
        AI Beta can be wrong — compare every value with the photo before you send it.
      </Txt>
      <View style={styles.confBadge}>
        <Icon name="sparkle" size={14} color={conf >= 0.8 ? colors.accent : colors.draw} />
        <Txt size={12} color={conf >= 0.8 ? colors.accent : colors.draw}>
          {confLabel} ({(conf * 100).toFixed(0)}%)
        </Txt>
      </View>
      {flow.extraction?.flags?.length ? (
        <View style={styles.flagBox}>
          {flow.extraction.flags.map((f) => (
            <Txt key={f} size={12} color={colors.draw} style={{ lineHeight: 18 }}>
              <Txt size={12} color={colors.accent}>
                !
              </Txt>{" "}
              {flagLabel(f)}
            </Txt>
          ))}
        </View>
      ) : null}

      <View style={{ height: spacing.lg }} />
      <PhoneThumb flow={flow} maxHeight={200} />

      <Txt variant="head" size={11} color={colors.textDim} style={styles.sectionLabel}>
        SCORE
      </Txt>
      <Card style={{ paddingVertical: spacing.xl }}>
        <View style={styles.scoreRow}>
          <ScoreSide player={flow.me} name="You" team={flow.myTeam?.name}>
            <ScoreStepper
              value={flow.myGoals}
              onChange={(value) => {
                editing();
                flow.setMyGoals(value);
              }}
              label="your goals"
              color={statColor(flow.myGoals, mine?.goals)}
              size={isTablet ? "lg" : "md"}
            />
          </ScoreSide>
          <Txt variant="monoBold" size={30} color={colors.textFaint} style={{ marginBottom: 8 }}>
            :
          </Txt>
          <ScoreSide player={flow.opponent} name={oppFirst} team={flow.opponentTeam?.name}>
            <ScoreStepper
              value={flow.opponentGoals}
              onChange={(value) => {
                editing();
                flow.setOpponentGoals(value);
              }}
              label={`${oppFirst}'s goals`}
              color={statColor(flow.opponentGoals, theirs?.goals)}
              size={isTablet ? "lg" : "md"}
              returnKeyType="done"
            />
          </ScoreSide>
        </View>
      </Card>

      <View style={{ marginTop: spacing.x2 }}>
        <View style={styles.statHead}>
          <Txt
            variant="head"
            size={11}
            color={colors.textDim}
            style={[styles.kicker, styles.statLabel]}
          >
            KEY STATS
          </Txt>
          <View style={styles.statEditFields}>
            <Txt
              variant="head"
              size={11}
              color={colors.textDim}
              style={{ flex: 1, textAlign: "center" }}
            >
              YOU
            </Txt>
            <Txt
              variant="head"
              size={11}
              color={colors.textDim}
              style={{ flex: 1, textAlign: "center" }}
              numberOfLines={1}
            >
              {oppFirst.toUpperCase()}
            </Txt>
          </View>
        </View>
        <View style={{ gap: spacing.sm }}>
          <StatEditRow
            label="Possession %"
            myValue={flow.myPossession}
            oppValue={flow.opponentPossession}
            onChangeMy={edit(flow.setMyPossession)}
            onChangeOpp={edit(flow.setOpponentPossession)}
            oppName={oppFirst}
            myColor={statColor(flow.myPossession, mine?.possession)}
            oppColor={statColor(flow.opponentPossession, theirs?.possession)}
          />
          <StatEditRow
            label="Shots"
            myValue={flow.myShots}
            oppValue={flow.opponentShots}
            onChangeMy={edit(flow.setMyShots)}
            onChangeOpp={edit(flow.setOpponentShots)}
            oppName={oppFirst}
            myColor={statColor(flow.myShots, mine?.shots)}
            oppColor={statColor(flow.opponentShots, theirs?.shots)}
          />
          <StatEditRow
            label="On target"
            myValue={flow.myShotsOnTarget}
            oppValue={flow.opponentShotsOnTarget}
            onChangeMy={edit(flow.setMyShotsOnTarget)}
            onChangeOpp={edit(flow.setOpponentShotsOnTarget)}
            oppName={oppFirst}
            myColor={statColor(flow.myShotsOnTarget, mine?.shots_on_target)}
            oppColor={statColor(flow.opponentShotsOnTarget, theirs?.shots_on_target)}
          />
          <StatEditRow
            label="Expected goals"
            myValue={flow.myXg}
            oppValue={flow.opponentXg}
            onChangeMy={edit(flow.setMyXg)}
            onChangeOpp={edit(flow.setOpponentXg)}
            oppName={oppFirst}
            decimal
            myColor={statColor(flow.myXg, mine?.xg)}
            oppColor={statColor(flow.opponentXg, theirs?.xg)}
          />
        </View>
      </View>

      <Card style={{ marginTop: spacing.x2, gap: spacing.sm }}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
          ELO AFTER CONFIRMATION
        </Txt>
        <EloLine label="You" before={flow.myElo} delta={flow.myDelta} strong />
        <EloLine label={oppFirst} before={flow.opponentElo} delta={flow.opponentDelta} />
      </Card>
      <View style={styles.sourceTag}>
        <Tag tone="accent">AI</Tag>
        <Txt size={11.5} color={colors.textDim}>
          Photo-assisted · you were the {flow.mySide} side · edited values show in green
        </Txt>
      </View>
    </StepPage>
  );
}

function ScoreSide({
  player,
  name,
  team,
  children,
}: {
  player: Parameters<typeof Avatar>[0]["player"];
  name: string;
  team?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.scoreSide}>
      <Avatar player={player} size={44} jersey />
      <Txt variant="bodyMedium" size={13.5} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {name}
      </Txt>
      <Txt
        size={11}
        color={colors.textDim}
        numberOfLines={1}
        style={{ marginTop: 2, marginBottom: spacing.md }}
      >
        {team ?? "—"}
      </Txt>
      {children}
    </View>
  );
}

export function DoneStep({ flow }: Flow) {
  if (!flow.opponent) return null;
  const matchId = flow.submittedMatchId;
  return (
    <MatchSubmitted
      me={flow.me}
      opponent={flow.opponent}
      myGoals={flow.myGoals}
      opponentGoals={flow.opponentGoals}
      myTeam={flow.myTeam?.name}
      opponentTeam={flow.opponentTeam?.name}
      myElo={flow.myElo}
      myDelta={flow.myDelta}
      opponentElo={flow.opponentElo}
      opponentDelta={flow.opponentDelta}
      onRematch={flow.rematch}
      onView={matchId && flow.onViewMatch ? () => flow.onViewMatch?.(matchId) : undefined}
      onDone={flow.onDone}
    />
  );
}
