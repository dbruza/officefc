/**
 * Head-to-head: any two players' all-time series. Desktop lays it out as a tale of the
 * tape — player A | mirrored stat bars | player B — with recent meetings below; phones
 * stack a score banner, the pickers, then the same tape. Player A defaults to the viewer.
 * Only the selected pair's data is ever shown: while another pair loads, the tape shows a
 * skeleton instead of the previous pair's numbers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  Card,
  EloDelta,
  EmptyState,
  ErrorCard,
  Grid,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  Tag,
  Txt,
  CountUp,
} from "@/components";
import { TaleOfTheTape, type TapeRow } from "@/components/TaleOfTheTape";
import { useAuth } from "@/lib/auth";
import {
  getHeadToHead,
  getLeaguePlayers,
  h2hPairKey,
  type HeadToHead,
  type H2HMeeting,
  type LeaguePlayer,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { useBreakpoint } from "@/lib/responsive";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import { computeRivalryStats, RIVAL_MIN_GAMES } from "@/lib/stats/rivalry";
import type { MatchResult } from "@/types";

/** Point-of-view badge; `short` fits the narrow phone banner. */
type SideTag = { text: string; short: string; tone: "accent" | "loss" } | null;

export default function HeadToHeadRoute() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDesktop, isPhone } = useBreakpoint();
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const [aId, setAId] = useState(params.a ?? "");
  const [bId, setBId] = useState(params.b ?? "");
  const viewerId = user?.uid ?? null;

  const roster = useFocusData(
    "h2h-roster",
    useCallback(() => getLeaguePlayers(), []),
  );
  const players = useMemo(() => roster.data ?? [], [roster.data]);

  // Resolve the pair once the roster is in: keep valid picks (deep links), otherwise the
  // viewer on the left and the first other player on the right.
  useEffect(() => {
    if (!players.length) return;
    const valid = (id: string) => players.some((player) => player.id === id);
    const nextA = valid(aId) ? aId : viewerId && valid(viewerId) ? viewerId : players[0].id;
    const nextB =
      valid(bId) && bId !== nextA ? bId : (players.find((player) => player.id !== nextA)?.id ?? "");
    if (nextA !== aId) setAId(nextA);
    if (nextB !== bId) setBId(nextB);
  }, [players, viewerId, aId, bId]);

  // Keyed by the sorted pair: swapping sides reuses the same cached document.
  const pairKey = aId && bId && aId !== bId ? h2hPairKey(aId, bId) : "";
  const pair = useFocusData<HeadToHead | null>(
    `h2h:${pairKey}`,
    useCallback(async () => (pairKey ? getHeadToHead(aId, bId) : null), [pairKey, aId, bId]),
  );
  const headToHead = pair.data ?? null;
  const pairReady =
    !!pairKey &&
    pair.data !== undefined &&
    !pair.stale &&
    (headToHead === null || headToHead.pairKey === pairKey);

  const a = players.find((player) => player.id === aId);
  const b = players.find((player) => player.id === bId);
  const oriented = orient(pairReady ? headToHead : null, aId);
  const total = oriented.wins + oriented.draws + oriented.losses;
  const rivalry = useMemo(
    () => (pairReady && headToHead ? orientRivalry(headToHead, aId) : null),
    [pairReady, headToHead, aId],
  );

  const leader: "a" | "b" | null =
    total >= RIVAL_MIN_GAMES
      ? oriented.wins > oriented.losses
        ? "a"
        : oriented.losses > oriented.wins
          ? "b"
          : null
      : null;
  // Point-of-view copy: "Your nemesis" only when the viewer is in the pair and trails it.
  const viewerSide = viewerId === aId ? "a" : viewerId === bId ? "b" : null;
  const tagFor = (side: "a" | "b"): SideTag => {
    if (leader !== side) return null;
    return viewerSide && viewerSide !== side
      ? { text: "YOUR NEMESIS", short: "NEMESIS", tone: "loss" }
      : { text: "HAS THE EDGE", short: "LEADS", tone: "accent" };
  };

  function selectA(id: string) {
    setAId(id);
    router.setParams({ a: id });
  }
  function selectB(id: string) {
    setBId(id);
    router.setParams({ b: id });
  }
  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);

  const tapeRows: TapeRow[] = rivalry
    ? [
        { key: "wins", label: "Wins", a: oriented.wins, b: oriented.losses },
        { key: "goals", label: "Goals", a: oriented.goalsFor, b: oriented.goalsAgainst },
        {
          key: "clean",
          label: "Clean sheets",
          a: rivalry.aCleanSheets,
          b: rivalry.bCleanSheets,
        },
        {
          key: "best",
          label: "Biggest win",
          a: rivalry.aBest?.margin ?? 0,
          b: rivalry.bBest?.margin ?? 0,
          aText: rivalry.aBest?.score ?? "—",
          bText: rivalry.bBest?.score ?? "—",
        },
        {
          key: "swing",
          label: "ELO swing",
          a: rivalry.aEloSwing,
          b: rivalry.bEloSwing,
          aText: formatSwing(rivalry.aEloSwing),
          bText: formatSwing(rivalry.bEloSwing),
        },
      ]
    : [];

  const loadingRoster = !roster.data && !roster.error;
  const enoughPlayers = players.length >= 2;
  const pairFailed = pair.error && !pairReady;

  const tape =
    a && b && pairReady && total > 0 ? (
      <TaleOfTheTape
        aName={firstName(a.name)}
        bName={firstName(b.name)}
        wins={oriented.wins}
        draws={oriented.draws}
        losses={oriented.losses}
        rows={tapeRows}
        showScore={isDesktop}
        footnote="Clean sheets, biggest wins and ELO swing cover the last 20 meetings."
      />
    ) : null;

  const noMeetings =
    a && b && pairReady && total === 0 ? (
      <EmptyState
        icon="swords"
        title="No meetings yet"
        body={`${firstName(a.name)} and ${firstName(b.name)} haven't played a confirmed match. Get them on the sticks.`}
        action={{ label: "Log a match", icon: "plus", onPress: () => router.push("/log-match") }}
        // On desktop it sits inside the tape card, which already draws the frame.
        style={isDesktop ? styles.bareEmpty : undefined}
      />
    ) : null;

  const tapeSkeleton =
    a && b && !pairReady && !pairFailed ? (
      <View
        style={{ gap: spacing.md }}
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
      >
        {isDesktop ? <Skeleton width={160} height={56} style={{ alignSelf: "center" }} /> : null}
        <Skeleton height={10} round={5} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={22} style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </View>
    ) : null;

  const pairError = pairFailed ? (
    <ErrorCard
      message="Couldn't load this head-to-head. Check the connection and retry."
      onRetry={pair.reload}
      retrying={pair.refreshing || pair.loading}
    />
  ) : null;

  const biggestWin = rivalry?.biggestWin ?? null;
  const heaviest =
    rivalry && biggestWin && a && b ? (
      <Card
        onPress={() => openMatch(biggestWin.matchId)}
        accessibilityLabel="Open the heaviest result"
        style={styles.heaviest}
      >
        <View style={styles.heaviestIcon}>
          <Icon name="bolt" size={16} color={colors.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.eyebrow}>
            HEAVIEST RESULT
          </Txt>
          <Txt size={13} numberOfLines={1} style={{ marginTop: 2 }}>
            <Txt variant="monoBold" size={15}>
              {biggestWin.winnerGoals}–{biggestWin.loserGoals}
            </Txt>
            {"  "}
            {firstName(biggestWin.winnerId === aId ? a.name : b.name)} over{" "}
            {firstName(biggestWin.winnerId === aId ? b.name : a.name)}
            {biggestWin.date
              ? ` · ${biggestWin.date.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : ""}
          </Txt>
        </View>
        {rivalry.avgGoalsPerGame != null ? (
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="monoBold" size={17}>
              {rivalry.avgGoalsPerGame.toFixed(1)}
            </Txt>
            <Txt size={10.5} color={colors.textDim}>
              goals / game
            </Txt>
          </View>
        ) : null}
        <Icon name="chevron" size={14} color={colors.textFaint} />
      </Card>
    ) : null;

  const meetings =
    a && b && pairReady && oriented.meetings.length > 0 ? (
      <View>
        <SectionLabel>Recent meetings</SectionLabel>
        <Grid min={340} maxColumns={2} gap={spacing.sm}>
          {oriented.meetings.map((meeting, i) => (
            <Reveal key={meeting.matchId} index={i}>
              <MeetingRow
                meeting={meeting}
                a={a}
                b={b}
                onPress={() => openMatch(meeting.matchId)}
              />
            </Reveal>
          ))}
        </Grid>
      </View>
    ) : null;

  const pickerMode = isPhone ? "strip" : "wrap";

  return (
    <Page
      width="default"
      refreshing={roster.refreshing || pair.refreshing}
      onRefresh={() => {
        void roster.reload();
        void pair.reload();
      }}
      header={
        <ScreenHeader
          title="Head-to-head"
          subtitle={a && b ? `${a.name} v ${b.name}` : undefined}
          documentTitle={a && b ? `${firstName(a.name)} v ${firstName(b.name)}` : "Head-to-head"}
          onRefresh={() => {
            void roster.reload();
            void pair.reload();
          }}
          refreshing={roster.refreshing || pair.refreshing}
        />
      }
    >
      {roster.error ? (
        <ErrorCard
          message="Couldn't load the players. Check the connection and retry."
          onRetry={roster.reload}
          retrying={roster.refreshing || roster.loading}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      {loadingRoster ? (
        <View style={{ gap: spacing.lg }}>
          <SkeletonCard height={isDesktop ? 260 : 170} />
          <SkeletonRows count={3} />
        </View>
      ) : null}

      {roster.data && !enoughPlayers ? (
        <EmptyState
          icon="users"
          title="Not enough players yet"
          body="Head-to-heads need at least two players in the league."
        />
      ) : null}

      {a && b ? (
        isDesktop ? (
          <View style={{ gap: spacing.x2 }}>
            <View style={styles.stage}>
              <PlayerColumn
                slotName="Player 1"
                player={a}
                from="right"
                tag={pairReady ? tagFor("a") : null}
                isViewer={a.id === viewerId}
                players={players}
                excluded={bId}
                onSelect={selectA}
                viewerId={viewerId}
              />
              <Card style={styles.tapeCard}>{pairError ?? tapeSkeleton ?? tape ?? noMeetings}</Card>
              <PlayerColumn
                slotName="Player 2"
                player={b}
                from="left"
                tag={pairReady ? tagFor("b") : null}
                isViewer={b.id === viewerId}
                players={players}
                excluded={aId}
                onSelect={selectB}
                viewerId={viewerId}
              />
            </View>
            {heaviest}
            {meetings}
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <View style={styles.banner}>
              <VersusPlayer
                player={a}
                from="right"
                tag={pairReady ? tagFor("a") : null}
                isViewer={a.id === viewerId}
              />
              <View style={{ alignItems: "center" }}>
                {pairReady ? (
                  <View style={styles.bannerScore}>
                    <CountUp
                      value={oriented.wins}
                      from={0}
                      variant="monoBold"
                      size={40}
                      color={oriented.wins > oriented.losses ? colors.accent : colors.text}
                    />
                    <Txt variant="monoBold" size={30} color={colors.textFaint}>
                      –
                    </Txt>
                    <CountUp
                      value={oriented.losses}
                      from={0}
                      variant="monoBold"
                      size={40}
                      color={oriented.losses > oriented.wins ? colors.accent : colors.text}
                    />
                  </View>
                ) : (
                  <Skeleton width={96} height={40} />
                )}
                <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                  {pairReady ? `${oriented.draws} DRAWN · ${total} PLAYED` : "LOADING"}
                </Txt>
              </View>
              <VersusPlayer
                player={b}
                from="left"
                tag={pairReady ? tagFor("b") : null}
                isViewer={b.id === viewerId}
              />
            </View>

            <View style={{ gap: spacing.sm }}>
              <PlayerPicker
                label="Player 1"
                slotName="Player 1"
                mode={pickerMode}
                players={players}
                selected={aId}
                excluded={bId}
                onSelect={selectA}
                viewerId={viewerId}
              />
              <PlayerPicker
                label="Player 2"
                slotName="Player 2"
                mode={pickerMode}
                players={players}
                selected={bId}
                excluded={aId}
                onSelect={selectB}
                viewerId={viewerId}
              />
            </View>

            {pairError ?? (tapeSkeleton ? <Card>{tapeSkeleton}</Card> : null)}
            {tape ? (
              <View>
                <SectionLabel>Tale of the tape</SectionLabel>
                <Card>{tape}</Card>
              </View>
            ) : null}
            {noMeetings}
            {heaviest}
            {meetings}
          </View>
        )
      ) : null}
    </Page>
  );
}

function PlayerColumn({
  slotName,
  player,
  from,
  tag,
  isViewer,
  players,
  excluded,
  onSelect,
  viewerId,
}: {
  slotName: string;
  player: LeaguePlayer;
  from: "left" | "right";
  tag: SideTag;
  isViewer: boolean;
  players: LeaguePlayer[];
  excluded: string;
  onSelect: (uid: string) => void;
  viewerId: string | null;
}) {
  return (
    <Card style={styles.column}>
      <Reveal key={player.id} from={from} duration={460} style={styles.columnHero}>
        <Avatar player={player} size={96} ring={!!tag && tag.tone === "accent"} jersey />
        <Txt variant="head" size={20} numberOfLines={1} style={{ marginTop: spacing.md }}>
          {player.name}
        </Txt>
        <Txt size={12} color={colors.textDim}>
          @{player.handle}
        </Txt>
        <View style={styles.tagSlot}>
          {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : isViewer ? <Tag>YOU</Tag> : null}
        </View>
      </Reveal>
      <View style={styles.columnPicker}>
        <PlayerPicker
          label="Change player"
          slotName={slotName}
          mode="wrap"
          players={players}
          selected={player.id}
          excluded={excluded}
          onSelect={onSelect}
          viewerId={viewerId}
        />
      </View>
    </Card>
  );
}

/** Chip picker: wrapping chips where a mouse is likely, a swipeable strip on phones. */
function PlayerPicker({
  label,
  slotName,
  mode,
  players,
  selected,
  excluded,
  onSelect,
  viewerId,
}: {
  label: string;
  /** Accessible prefix that tells the two pickers apart ("Player 1: James Okafor"). */
  slotName: string;
  mode: "wrap" | "strip";
  players: LeaguePlayer[];
  selected: string;
  excluded: string;
  onSelect: (uid: string) => void;
  viewerId: string | null;
}) {
  // The viewer leads the list: it's the pick people make most, and on phones the strip
  // would otherwise hide it off-screen.
  const ordered = viewerId
    ? [
        ...players.filter((player) => player.id === viewerId),
        ...players.filter((player) => player.id !== viewerId),
      ]
    : players;
  const chips = ordered
    .filter((player) => player.id !== excluded)
    .map((player) => {
      const active = selected === player.id;
      return (
        <Interactive
          key={player.id}
          onPress={() => onSelect(player.id)}
          accessibilityLabel={`${slotName}: ${player.name}`}
          accessibilityState={{ selected: active }}
          pressScale={0.96}
          style={[styles.pickChip, active && styles.pickChipActive]}
          hoverStyle={
            !active
              ? { borderColor: colors.lineStrong, backgroundColor: colors.surface2 }
              : undefined
          }
        >
          <Avatar player={player} size={22} />
          <Txt
            variant="bodyMedium"
            size={12}
            color={active ? colors.accent : colors.textDim}
            numberOfLines={1}
          >
            {player.id === viewerId ? "You" : firstName(player.name)}
          </Txt>
        </Interactive>
      );
    });
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="head" size={10} color={colors.textFaint} style={styles.eyebrow}>
        {label.toUpperCase()}
      </Txt>
      {mode === "strip" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pickerStrip}
        >
          {chips}
        </ScrollView>
      ) : (
        <View style={styles.pickerWrap}>{chips}</View>
      )}
    </View>
  );
}

function VersusPlayer({
  player,
  from,
  tag,
  isViewer,
}: {
  player: LeaguePlayer;
  from: "left" | "right";
  tag: SideTag;
  isViewer: boolean;
}) {
  return (
    <Reveal key={player.id} from={from} duration={420} style={styles.versusPlayer}>
      <Avatar player={player} size={56} ring={!!tag && tag.tone === "accent"} jersey />
      <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {isViewer ? "You" : firstName(player.name)}
      </Txt>
      <View style={styles.tagSlotSm}>{tag ? <Tag tone={tag.tone}>{tag.short}</Tag> : null}</View>
    </Reveal>
  );
}

function MeetingRow({
  meeting,
  a,
  b,
  onPress,
}: {
  meeting: OrientedMeeting;
  a: LeaguePlayer;
  b: LeaguePlayer;
  onPress: () => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${a.name} ${meeting.goalsFor}, ${b.name} ${meeting.goalsAgainst}`}
      style={styles.meeting}
      hoverStyle={{ borderColor: colors.lineStrong, backgroundColor: colors.surface2 }}
    >
      <ResultDot result={meeting.result} />
      <Txt size={11.5} color={colors.textDim} style={{ width: 50 }}>
        {meeting.date
          ? meeting.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
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
    </Interactive>
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

/** Signed ELO swing: "+12" / "-8"; zero stays neutral rather than claiming a winner. */
function formatSwing(swing: number): string {
  if (swing > 0) return `+${swing}`;
  return String(swing);
}

type OrientedMeeting = ReturnType<typeof orientMeeting>;

function orient(headToHead: HeadToHead | null, aId: string) {
  if (!headToHead) {
    return {
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      meetings: [] as OrientedMeeting[],
    };
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

/**
 * Rivalry facts from the screen's left player's point of view. The read model's a/b are
 * the lexically sorted uids, not the screen's sides, so per-side numbers must be swapped
 * when the left player is the document's `b`.
 */
function orientRivalry(headToHead: HeadToHead, aId: string) {
  const stats = computeRivalryStats(headToHead);
  const asA = headToHead.aId === aId;
  const meetings = headToHead.meetings.map((meeting) => orientMeeting(meeting, asA));
  const best = (forLeft: boolean) => {
    let top: { margin: number; score: string } | null = null;
    for (const meeting of meetings) {
      const margin = forLeft
        ? meeting.goalsFor - meeting.goalsAgainst
        : meeting.goalsAgainst - meeting.goalsFor;
      if (margin > 0 && (!top || margin > top.margin)) {
        top = {
          margin,
          score: forLeft
            ? `${meeting.goalsFor}–${meeting.goalsAgainst}`
            : `${meeting.goalsAgainst}–${meeting.goalsFor}`,
        };
      }
    }
    return top;
  };
  return {
    biggestWin: stats.biggestWin,
    avgGoalsPerGame: stats.avgGoalsPerGame,
    aCleanSheets: asA ? stats.aCleanSheets : stats.bCleanSheets,
    bCleanSheets: asA ? stats.bCleanSheets : stats.aCleanSheets,
    aEloSwing: asA ? stats.aEloSwing : stats.bEloSwing,
    bEloSwing: asA ? stats.bEloSwing : stats.aEloSwing,
    aBest: best(true),
    bBest: best(false),
  };
}

const styles = StyleSheet.create({
  eyebrow: { letterSpacing: 1.2 },
  bareEmpty: { borderWidth: 0, backgroundColor: "transparent" },
  stage: { flexDirection: "row", alignItems: "stretch", gap: spacing.lg },
  column: { width: 268, padding: 0, overflow: "hidden" },
  columnHero: {
    alignItems: "center",
    paddingTop: spacing.x2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tagSlot: { height: 24, justifyContent: "center", marginTop: spacing.sm },
  tagSlotSm: { height: 20, justifyContent: "center", marginTop: 4 },
  columnPicker: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: withAlpha(colors.bg, 0.4),
  },
  tapeCard: { flex: 1, minWidth: 0, padding: spacing.x2, justifyContent: "center" },
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
  bannerScore: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  versusPlayer: { flex: 1, alignItems: "center", minWidth: 0 },
  kicker: { letterSpacing: 1.1, marginTop: 4 },
  pickerStrip: { gap: spacing.sm, paddingRight: spacing.lg },
  pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  pickChipActive: {
    borderColor: withAlpha(colors.accent, 0.55),
    backgroundColor: withAlpha(colors.accent, 0.1),
  },
  heaviest: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heaviestIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.gold, 0.12),
  },
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
