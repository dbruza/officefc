import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { Avatar, Button, Card, EloDelta, Icon, Txt } from "@/components";
import { colors, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { TeamPicker } from "../TeamPicker";
import { FlowFooter, ProgressBar, ScoreBox, StatEditRow } from "./parts";
import { flagLabel, statColor } from "./helpers";
import { styles } from "./styles";
import type { SnapFlowState } from "./useSnapFlow";

export function CaptureStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => void flow.handleLeave("cancel")} style={styles.iconBtn}>
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
          Use the full-time stats screen. AI Beta will suggest the score and key stats, but you must
          verify every value.
        </Txt>
        <View
          style={{
            gap: spacing.md,
            marginTop: spacing.x2,
            width: "100%",
            paddingHorizontal: spacing.x2,
          }}
        >
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
            {flow.isWebWide ? "Choose image file" : "Choose from library"}
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
        </View>
        <View style={styles.privacyNotice}>
          <Txt size={11.5} color={colors.textDim} style={{ textAlign: "center", lineHeight: 17 }}>
            Photos stay private. Anthropic processes the image for extraction. League members can
            view submitted photos through temporary links, submitters can delete them, and abandoned
            drafts are deleted after 24 hours.
          </Txt>
        </View>
        {flow.error ? (
          <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg, textAlign: "center" }}>
            {flow.error}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

export function ProcessingStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => void flow.handleLeave("cancel")} style={styles.iconBtn}>
          <Icon name="x" size={20} stroke={2.5} />
        </Pressable>
        <Txt variant="head" size={18}>
          Processing
        </Txt>
      </View>
      <View style={styles.centerContent}>
        {flow.imageUri ? (
          <Image source={{ uri: flow.imageUri }} style={styles.previewImage} resizeMode="contain" />
        ) : null}
        <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: spacing.x2 }} />
        <Txt color={colors.textDim} size={13} style={{ marginTop: spacing.md }}>
          Uploading and analyzing the stats screen…
        </Txt>
      </View>
    </View>
  );
}

export function SideStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <ProgressBar current={0} total={4} label="Which side were you?" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
          Which side were you on?
        </Txt>
        {flow.imageUri ? (
          <Image source={{ uri: flow.imageUri }} style={styles.smallPreview} resizeMode="contain" />
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
              flow.setMySide("home");
              flow.setStep("opponent");
            }}
            style={[styles.optionCard, flow.mySide === "home" && styles.optionActive]}
          >
            <Icon
              name="bolt"
              size={20}
              color={flow.mySide === "home" ? colors.accent : colors.textDim}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyMedium" size={14.5}>
                I was the Home team (left side)
              </Txt>
              <Txt size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                {flow.extraction?.suggestion?.home?.goals != null
                  ? `Goals read: ${flow.extraction.suggestion.home.goals}`
                  : "Goals unreadable"}
              </Txt>
            </View>
            <Icon name="chevron" size={14} color={colors.textDim} />
          </Pressable>
          <Pressable
            onPress={() => {
              flow.setMySide("away");
              flow.setStep("opponent");
            }}
            style={[styles.optionCard, flow.mySide === "away" && styles.optionActive]}
          >
            <Icon
              name="bolt"
              size={20}
              color={flow.mySide === "away" ? colors.accent : colors.textDim}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyMedium" size={14.5}>
                I was the Away team (right side)
              </Txt>
              <Txt size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                {flow.extraction?.suggestion?.away?.goals != null
                  ? `Goals read: ${flow.extraction.suggestion.away.goals}`
                  : "Goals unreadable"}
              </Txt>
            </View>
            <Icon name="chevron" size={14} color={colors.textDim} />
          </Pressable>
        </View>
      </ScrollView>
      <FlowFooter onBack={() => void flow.handleLeave("cancel")} onSkip={() => {}} hideNext />
    </View>
  );
}

export function OpponentStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <ProgressBar current={1} total={4} label="Opponent" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
          Who did you play?
        </Txt>
        <View style={{ gap: spacing.sm }}>
          {flow.players.map((player) => (
            <Pressable
              key={player.id}
              onPress={() => {
                flow.setOpponent(player);
                flow.setStep("teams");
              }}
              style={[styles.pickRow, flow.opponent?.id === player.id && styles.pickRowActive]}
            >
              <Avatar player={player} size={42} jersey />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMedium" size={14.5}>
                  {player.name}
                </Txt>
                <Txt variant="mono" size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                  ELO {flow.ratingByUid.get(player.id) ?? 1500} · @{player.handle}
                </Txt>
              </View>
              {flow.opponent?.id === player.id ? (
                <View style={styles.check}>
                  <Icon name="check" size={13} color={colors.onAccent} stroke={3} />
                </View>
              ) : null}
            </Pressable>
          ))}
          {flow.players.length === 0 ? (
            <Txt color={colors.textDim}>Invite another player before logging a match.</Txt>
          ) : null}
        </View>
      </ScrollView>
      <FlowFooter onBack={() => flow.setStep("side")} onSkip={() => {}} hideNext />
    </View>
  );
}

export function TeamsStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <ProgressBar current={2} total={4} label="Teams" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
          Which teams did you use?
        </Txt>
        <TeamPicker
          label="Your team"
          player={flow.me}
          teams={flow.teams}
          value={flow.myTeam}
          onChange={(t) => {
            flow.setMyTeam(t);
            if (flow.opponentTeam) flow.setStep("prefill");
          }}
        />
        <View style={{ height: spacing.lg }} />
        <TeamPicker
          label={`${flow.opponent?.name?.split(" ")[0] ?? "Opponent"}'s team`}
          player={flow.opponent}
          teams={flow.teams}
          value={flow.opponentTeam}
          onChange={(t) => {
            flow.setOpponentTeam(t);
            if (flow.myTeam) flow.setStep("prefill");
          }}
        />
      </ScrollView>
      <FlowFooter
        onBack={() => flow.setStep("opponent")}
        onSkip={() => (flow.myTeam && flow.opponentTeam ? flow.setStep("prefill") : null)}
        nextDisabled={!flow.myTeam || !flow.opponentTeam}
      />
    </View>
  );
}

export function PrefillStep({ flow }: { flow: SnapFlowState }) {
  const s = flow.extraction?.suggestion;
  const conf = flow.extraction?.confidence ?? 0;
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

        {flow.extraction?.flags?.length ? (
          <View style={styles.flagBox}>
            {flow.extraction.flags.map((f) => (
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
          <Txt variant="head" size={11} color={colors.textDim} style={{ marginBottom: spacing.sm }}>
            SCORE
          </Txt>
          <View style={styles.scoreRow}>
            <ScoreBox
              label="You"
              value={flow.myGoals}
              color={statColor(
                flow.myGoals,
                flow.mySide === "home" ? s?.home?.goals : s?.away?.goals,
              )}
              onChange={flow.setMyGoals}
            />
            <Txt variant="monoBold" size={28} color={colors.textFaint}>
              :
            </Txt>
            <ScoreBox
              label={flow.opponent?.name?.split(" ")[0] ?? "Opp"}
              value={flow.opponentGoals}
              color={statColor(
                flow.opponentGoals,
                flow.mySide === "home" ? s?.away?.goals : s?.home?.goals,
              )}
              onChange={flow.setOpponentGoals}
            />
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Txt variant="head" size={11} color={colors.textDim} style={{ marginBottom: spacing.sm }}>
            KEY STATS
          </Txt>
          <View style={{ gap: spacing.sm }}>
            <StatEditRow
              label="Possession %"
              myValue={flow.myPossession}
              oppValue={flow.opponentPossession}
              onChangeMy={flow.setMyPossession}
              onChangeOpp={flow.setOpponentPossession}
            />
            <StatEditRow
              label="Total Shots"
              myValue={flow.myShots}
              oppValue={flow.opponentShots}
              onChangeMy={flow.setMyShots}
              onChangeOpp={flow.setOpponentShots}
            />
            <StatEditRow
              label="Shots on Target"
              myValue={flow.myShotsOnTarget}
              oppValue={flow.opponentShotsOnTarget}
              onChangeMy={flow.setMyShotsOnTarget}
              onChangeOpp={flow.setOpponentShotsOnTarget}
            />
          </View>
        </View>
      </ScrollView>
      <FlowFooter
        onBack={() => flow.setStep("teams")}
        onSkip={() => flow.setStep("review")}
        nextLabel="Review"
      />
    </View>
  );
}

export function ReviewStep({ flow }: { flow: SnapFlowState }) {
  return (
    <View style={styles.full}>
      <ProgressBar current={4} total={4} label="Review" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Txt variant="head" size={22} style={{ marginBottom: spacing.lg }}>
          Look right?
        </Txt>

        {flow.imageUri ? (
          <Image source={{ uri: flow.imageUri }} style={styles.reviewImage} resizeMode="contain" />
        ) : null}

        <Card style={{ marginTop: spacing.lg }}>
          <View style={styles.reviewScore}>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Avatar player={flow.me} size={44} jersey />
              <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }}>
                You
              </Txt>
              <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
                {flow.myTeam?.name ?? ""}
              </Txt>
            </View>
            <Txt variant="monoBold" size={38}>
              {flow.myGoals}
              <Txt variant="monoBold" size={38} color={colors.textFaint}>
                :
              </Txt>
              {flow.opponentGoals}
            </Txt>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Avatar player={flow.opponent ?? undefined} size={44} jersey />
              <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }}>
                {flow.opponent?.name?.split(" ")[0] ?? "Opp"}
              </Txt>
              <Txt size={10.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
                {flow.opponentTeam?.name ?? ""}
              </Txt>
            </View>
          </View>

          {flow.myPossession != null || flow.opponentPossession != null || flow.myShots != null ? (
            <>
              <View style={styles.divider} />
              <View style={styles.statsGrid}>
                {(flow.myPossession ?? flow.opponentPossession) != null ? (
                  <View style={styles.statPair}>
                    <Txt size={11} color={colors.textDim}>
                      POSSESSION
                    </Txt>
                    <Txt variant="mono" size={13}>
                      {flow.myPossession ?? "-"}% / {flow.opponentPossession ?? "-"}%
                    </Txt>
                  </View>
                ) : null}
                {(flow.myShots ?? flow.opponentShots) != null ? (
                  <View style={styles.statPair}>
                    <Txt size={11} color={colors.textDim}>
                      SHOTS
                    </Txt>
                    <Txt variant="mono" size={13}>
                      {flow.myShots ?? "-"} / {flow.opponentShots ?? "-"}
                    </Txt>
                  </View>
                ) : null}
                {(flow.myShotsOnTarget ?? flow.opponentShotsOnTarget) != null ? (
                  <View style={styles.statPair}>
                    <Txt size={11} color={colors.textDim}>
                      ON TARGET
                    </Txt>
                    <Txt variant="mono" size={13}>
                      {flow.myShotsOnTarget ?? "-"} / {flow.opponentShotsOnTarget ?? "-"}
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
              <EloDelta delta={flow.myDelta} />
              <Txt variant="mono" size={11} color={colors.textDim} style={{ marginTop: 3 }}>
                opponent {flow.opponentDelta >= 0 ? "+" : ""}
                {flow.opponentDelta}
              </Txt>
            </View>
          </View>
        </Card>

        <View style={styles.sourceTag}>
          <Icon name="bolt" size={12} color={colors.accent} />
          <Txt size={11} color={colors.textDim}>
            AI-assisted · {flow.mySide === "home" ? "Home" : "Away"} side
          </Txt>
        </View>
      </ScrollView>
      <FlowFooter
        onBack={() => flow.setStep("prefill")}
        onSkip={flow.handleSubmit}
        nextLabel="Submit match"
        nextDisabled={false}
        loading={flow.isSubmitting}
      />
    </View>
  );
}

export function DoneStep({ flow }: { flow: SnapFlowState }) {
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
          {flow.myGoals}
          <Txt variant="monoBold" size={56} color={colors.textFaint}>
            :
          </Txt>
          {flow.opponentGoals}
        </Txt>
        <Txt color={colors.textDim} style={{ textAlign: "center", lineHeight: 20 }}>
          {flow.opponent?.name?.split(" ")[0] ?? "Opponent"} needs to confirm before this affects
          the table.
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
              {flow.myElo + flow.myDelta} <EloDelta delta={flow.myDelta} />
            </Txt>
          </View>
          <Txt size={12} color={colors.textFaint}>
            pending
          </Txt>
        </Card>
        {flow.error ? (
          <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
            {flow.error}
          </Txt>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Button full size="lg" onPress={flow.onDone}>
          Back to dashboard
        </Button>
      </View>
    </View>
  );
}
