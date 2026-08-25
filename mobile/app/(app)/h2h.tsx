import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Avatar,
  Button,
  Card,
  EloDelta,
  Icon,
  ScreenHeader,
  SectionLabel,
  StatCard,
  Txt,
} from "@/components";
import {
  getHeadToHead,
  getLeaguePlayers,
  type HeadToHead,
  type H2HMeeting,
  type LeaguePlayer,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName, plural } from "@/lib/format";
import { computeRivalryStats } from "@/lib/stats/rivalry";
import type { MatchResult } from "@/types";

export default function HeadToHeadRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const [aId, setAId] = useState(params.a ?? "");
  const [bId, setBId] = useState(params.b ?? "");

  const {
    data: roster,
    loading,
    error,
    reload,
  } = useFocusData(
    "h2h-roster",
    useCallback(() => getLeaguePlayers(), []),
  );
  const players = useMemo(() => roster ?? [], [roster]);

  useEffect(() => {
    if (!players.length) return;
    setAId((current) => current || players[0]?.id || "");
    setBId(
      (current) =>
        current || players.find((player) => player.id !== (params.a ?? players[0]?.id))?.id || "",
    );
  }, [players, params.a]);

  const { data: headToHeadData } = useFocusData<HeadToHead | null>(
    `h2h:${aId}:${bId}`,
    useCallback(
      async () => (aId && bId && aId !== bId ? getHeadToHead(aId, bId) : null),
      [aId, bId],
    ),
  );
  const headToHead = headToHeadData ?? null;

  const a = players.find((player) => player.id === aId);
  const b = players.find((player) => player.id === bId);
  const oriented = orient(headToHead, aId);
  const total = oriented.wins + oriented.draws + oriented.losses;
  const rivalry = useMemo(
    () => (headToHead ? computeRivalryStats(headToHead) : null),
    [headToHead],
  );
  // Hoisted so the onPress closure below narrows cleanly instead of re-testing `rivalry`.
  const biggestWin = rivalry?.biggestWin ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Head-to-head" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load head-to-head records. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}
        {a && b && !error ? (
          <>
            <View style={styles.banner}>
              <VersusPlayer player={a} dominant={oriented.wins > oriented.losses && total >= 3} />
              <View style={{ alignItems: "center" }}>
                <Txt variant="monoBold" size={40}>
                  <Txt
                    variant="monoBold"
                    size={40}
                    color={oriented.wins > oriented.losses ? colors.accent : colors.text}
                  >
                    {oriented.wins}
                  </Txt>
                  <Txt variant="monoBold" size={38} color={colors.textFaint}>
                    {" – "}
                  </Txt>
                  <Txt
                    variant="monoBold"
                    size={40}
                    color={oriented.losses > oriented.wins ? colors.accent : colors.text}
                  >
                    {oriented.losses}
                  </Txt>
                </Txt>
                <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                  {oriented.draws} DRAWN · {total} PLAYED
                </Txt>
              </View>
              <VersusPlayer player={b} dominant={oriented.losses > oriented.wins && total >= 3} />
            </View>

            <View style={styles.pickers}>
              <PlayerPicker players={players} selected={aId} excluded={bId} onSelect={setAId} />
              <PlayerPicker players={players} selected={bId} excluded={aId} onSelect={setBId} />
            </View>

            <View style={styles.statRow}>
              <View style={{ flex: 1 }}>
                <StatCard
                  label={`${firstName(a.name)} goals`}
                  value={oriented.goalsFor}
                  sub="in this rivalry"
                  accent
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  label={`${firstName(b.name)} goals`}
                  value={oriented.goalsAgainst}
                  sub="in this rivalry"
                />
              </View>
            </View>

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel>Rivalry stats</SectionLabel>
              <Card>
                {biggestWin ? (
                  <BiggestWinRow
                    win={biggestWin}
                    nameOf={(id) => players.find((player) => player.id === id)?.name ?? "someone"}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/match/[id]",
                        params: { id: biggestWin.matchId },
                      } as Href)
                    }
                  />
                ) : (
                  <Txt size={11.5} color={colors.textFaint}>
                    No winner between them yet — every meeting level.
                  </Txt>
                )}
                <View style={styles.rivalryGrid}>
                  <RivalryStat
                    label="Goals / game"
                    value={
                      rivalry?.avgGoalsPerGame != null ? rivalry.avgGoalsPerGame.toFixed(1) : "—"
                    }
                  />
                  <RivalryStat
                    label={`${firstName(a.name)} clean sheets`}
                    value={rivalry ? plural(rivalry.aCleanSheets, "sheet") : "—"}
                  />
                  <RivalryStat
                    label={`${firstName(b.name)} clean sheets`}
                    value={rivalry ? plural(rivalry.bCleanSheets, "sheet") : "—"}
                  />
                  <RivalryStat
                    label={`${firstName(a.name)} ELO swing`}
                    value={formatSwing(rivalry?.aEloSwing ?? 0)}
                    tone={(rivalry?.aEloSwing ?? 0) > 0 ? colors.win : undefined}
                  />
                  <RivalryStat
                    label={`${firstName(b.name)} ELO swing`}
                    value={formatSwing(rivalry?.bEloSwing ?? 0)}
                    tone={(rivalry?.bEloSwing ?? 0) > 0 ? colors.win : undefined}
                  />
                  <RivalryStat label="Meetings" value={String(total)} />
                </View>
                <Txt size={10.5} color={colors.textFaint} style={{ marginTop: spacing.sm }}>
                  ELO swing covers the last 20 meetings only — older games predate swing tracking.
                </Txt>
              </Card>
            </View>

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel>Recent meetings</SectionLabel>
              <View style={{ gap: spacing.sm }}>
                {oriented.meetings.map((meeting) => (
                  <Pressable
                    key={meeting.matchId}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/match/[id]",
                        params: { id: meeting.matchId },
                      } as Href)
                    }
                    style={styles.meeting}
                  >
                    <ResultDot result={meeting.result} />
                    <Txt size={11.5} color={colors.textDim} style={{ width: 50 }}>
                      {meeting.date
                        ? meeting.date.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </Txt>
                    <View style={styles.meetingScore}>
                      <Avatar player={a} size={20} />
                      <Txt variant="monoBold" size={18}>
                        {meeting.goalsFor}
                        <Txt variant="monoBold" size={18} color={colors.textFaint}>
                          :
                        </Txt>
                        {meeting.goalsAgainst}
                      </Txt>
                      <Avatar player={b} size={20} />
                    </View>
                    <EloDelta delta={meeting.delta} size={11} />
                    <Icon name="chevron" size={14} color={colors.textFaint} />
                  </Pressable>
                ))}
                {!loading && oriented.meetings.length === 0 ? (
                  // Roster loaded fine but this pair has never met — a genuine empty state.
                  <Card style={{ alignItems: "center", paddingVertical: spacing.x2 }}>
                    <Txt color={colors.textDim}>No meetings yet. Get them on the sticks.</Txt>
                  </Card>
                ) : null}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlayerPicker({
  players,
  selected,
  excluded,
  onSelect,
}: {
  players: LeaguePlayer[];
  selected: string;
  excluded: string;
  onSelect: (uid: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pickerScroll}
    >
      {players
        .filter((player) => player.id !== excluded)
        .map((player) => (
          <Pressable
            key={player.id}
            onPress={() => onSelect(player.id)}
            style={[styles.pickChip, selected === player.id && styles.pickChipActive]}
          >
            <Avatar player={player} size={22} />
            <Txt
              variant="bodyMedium"
              size={11.5}
              color={selected === player.id ? colors.accent : colors.textDim}
            >
              {firstName(player.name)}
            </Txt>
          </Pressable>
        ))}
    </ScrollView>
  );
}

function VersusPlayer({ player, dominant }: { player: LeaguePlayer; dominant: boolean }) {
  return (
    <View style={styles.versusPlayer}>
      <Avatar player={player} size={54} ring={dominant} jersey />
      <Txt variant="bodyMedium" size={12.5} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {firstName(player.name)}
      </Txt>
      {dominant ? (
        <View style={styles.nemesis}>
          <Txt variant="monoBold" size={7.5} color={colors.loss}>
            NEMESIS
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function ResultDot({ result }: { result: MatchResult }) {
  const backgroundColor = result === "W" ? colors.win : result === "L" ? colors.loss : colors.draw;
  return (
    <View style={[styles.resultDot, { backgroundColor }]}>
      <Txt variant="monoBold" size={10} color={colors.onAccent}>
        {result}
      </Txt>
    </View>
  );
}

/** Signed ELO swing: "+12" / "−8"; zero stays neutral rather than claiming a winner. */
function formatSwing(swing: number): string {
  if (swing > 0) return `+${swing}`;
  return String(swing);
}

/** The heaviest result in the pairing, with the two names and the date it landed. */
function BiggestWinRow({
  win,
  nameOf,
  onPress,
}: {
  win: NonNullable<ReturnType<typeof computeRivalryStats>["biggestWin"]>;
  nameOf: (uid: string) => string;
  onPress: () => void;
}) {
  const dateLabel = win.date
    ? win.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  return (
    <Pressable onPress={onPress} style={styles.biggestWin}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="monoBold" size={22}>
          {win.winnerGoals}:{win.loserGoals}
        </Txt>
        <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
          Heaviest result · {nameOf(win.winnerId)} over {nameOf(win.loserId)}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </Txt>
      </View>
      <Icon name="chevron" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

function RivalryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.rivalryStat}>
      <Txt
        variant="monoBold"
        size={17}
        style={{ color: tone ?? colors.text }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Txt>
      <Txt size={10.5} color={colors.textDim} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

function orient(headToHead: HeadToHead | null, aId: string) {
  if (!headToHead) {
    return { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, meetings: [] };
  }
  const asA = headToHead.aId === aId;
  return {
    wins: asA ? headToHead.aWins : headToHead.bWins,
    losses: asA ? headToHead.bWins : headToHead.aWins,
    draws: headToHead.draws,
    goalsFor: asA ? headToHead.aGoals : headToHead.bGoals,
    goalsAgainst: asA ? headToHead.bGoals : headToHead.aGoals,
    meetings: headToHead.meetings.map((meeting) => orientMeeting(meeting, asA)),
  };
}

function orientMeeting(meeting: H2HMeeting, asA: boolean) {
  const goalsFor = asA ? meeting.aGoals : meeting.bGoals;
  const goalsAgainst = asA ? meeting.bGoals : meeting.aGoals;
  return {
    ...meeting,
    goalsFor,
    goalsAgainst,
    delta: asA ? meeting.aDelta : meeting.bDelta,
    result: (goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D") as MatchResult,
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  banner: {
    minHeight: 164,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  versusPlayer: { flex: 1, alignItems: "center", minWidth: 0 },
  kicker: { letterSpacing: 1.1, marginTop: 4 },
  nemesis: {
    marginTop: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.35),
  },
  pickers: { gap: spacing.sm, marginTop: spacing.md },
  pickerScroll: { gap: spacing.sm, paddingRight: spacing.lg },
  pickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  pickChipActive: {
    borderColor: withAlpha(colors.accent, 0.5),
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  biggestWin: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rivalryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  rivalryStat: { width: "30.5%", gap: 2, minWidth: 0 },
  meetingScore: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  meeting: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  resultDot: {
    width: 25,
    height: 25,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});
