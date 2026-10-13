/**
 * The Leaderboard's Stats view: the season told through its people. Headline moments
 * lead, then the yearbook (a title for everyone who has played), the season's feuds next
 * to the hot & cold form board, and finally the AI-extracted xG / shots / possession
 * boards folded into a "Nerd corner".
 *
 * Facts come from the season summary (functions/src/models/callouts.ts); every word a
 * player reads comes from lib/calloutCopy.ts.
 */
import { useCallback, useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";

import {
  Avatar,
  Card,
  Columns,
  EmptyState,
  ErrorCard,
  Grid,
  Icon,
  Interactive,
  Reveal,
  SectionLabel,
  SkeletonCard,
  Tag,
  Txt,
  useGutter,
  type IconName,
} from "@/components";
import { GrowBar } from "@/components/GrowBar";
import { feudText, headlineViews, superlativeText, type HeadlineView } from "@/lib/calloutCopy";
import { mix, withAlpha } from "@/lib/color";
import { firstName, fmtXg } from "@/lib/format";
import type { LeaguePlayer, Standing } from "@/lib/league";
import { getSeasonSummary } from "@/lib/league/summaries";
import { useBreakpoint } from "@/lib/responsive";
import {
  emptyCallouts,
  type Feud,
  type SeasonCallouts,
  type Superlative,
} from "@/lib/stats/callouts";
import { type SeasonLeaderboardStats } from "@/lib/stats/seasonStats";
import type { StreakRow } from "../../../functions/src/models/streakBoard";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";

interface StatsData {
  stats: SeasonLeaderboardStats;
  streaks: StreakRow[];
  callouts: SeasonCallouts;
}

const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : `${value}`);

const shortDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Lazy-loaded stats view: mounts only while the Stats segment is active, caches after that. */
export function SeasonStatsBoard({
  seasonId,
  live,
  standings,
  players,
  youId,
  onOpen,
  reloadRef,
}: {
  seasonId: string;
  /** The season is still being played: "right now" wording and the title race. */
  live: boolean;
  /** This season's table, for the title race; empty while another season's is shown. */
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  youId: string | null | undefined;
  onOpen: (uid: string) => void;
  /** Lets the screen's refresh button reload these boards too. */
  reloadRef: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const router = useRouter();
  const { isTablet } = useBreakpoint();
  const [nerdOpen, setNerdOpen] = useState(false);
  const { data, refreshing, error, stale, reload } = useFocusData<StatsData>(
    `leaderboard-stats:${seasonId}`,
    useCallback(async () => {
      const summary = await getSeasonSummary(seasonId);
      return {
        stats: summary.stats,
        streaks: summary.streaks,
        // A summary from a server that predates callouts simply has none yet.
        callouts: summary.callouts ?? emptyCallouts(),
      };
    }, [seasonId]),
  );
  useEffect(() => {
    reloadRef.current = reload;
    return () => {
      reloadRef.current = null;
    };
  }, [reload, reloadRef]);

  if (!data) {
    // Nothing cached yet: skeleton on first load, but never a silent blank on a failed
    // first fetch — the failure card must stay reachable.
    return error ? (
      <ErrorCard
        message="Couldn't load the season stats. Check the connection and retry."
        onRetry={reload}
        retrying={refreshing}
      />
    ) : (
      <StatsSkeleton />
    );
  }

  const { stats, streaks, callouts } = data;
  const name = (uid: string) => players.get(uid)?.name ?? "Former player";
  const short = (uid: string) => firstName(name(uid));
  const headlines = headlineViews(callouts.headlines, standings, short, live);
  // The viewer's own title leads the yearbook (stable sort keeps everyone else's order).
  const yearbook = [...callouts.superlatives].sort(
    (x, y) => Number(y.playerId === youId) - Number(x.playerId === youId),
  );
  const hasNerdStats =
    stats.clinical.length > 0 || stats.shotVolume.length > 0 || stats.possession.length > 0;
  const empty =
    headlines.length === 0 && yearbook.length === 0 && streaks.length === 0 && !hasNerdStats;

  const openMatch = (id: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id } } as Href);
  const openH2h = (a: string, b: string) =>
    router.push({ pathname: "/(app)/h2h", params: { a, b } } as Href);
  const headlineCard = (view: HeadlineView, index: number, width?: number) => (
    <Reveal key={view.id} index={index} style={width ? { width } : { flex: 1 }}>
      <HeadlineCard
        view={view}
        player={players.get(view.playerId)}
        other={view.otherId ? players.get(view.otherId) : undefined}
        names={[short(view.playerId), view.otherId ? short(view.otherId) : null]}
        onPress={() =>
          view.matchId
            ? openMatch(view.matchId)
            : view.otherId
              ? openH2h(view.playerId, view.otherId)
              : onOpen(view.playerId)
        }
      />
    </Reveal>
  );

  if (empty) {
    return (
      <EmptyState
        icon="sparkle"
        title="The story starts with the first result"
        body="Headlines, a title for every player and the season's feuds fill in as confirmed matches land."
        action={
          live
            ? { label: "Log a match", icon: "plus", onPress: () => router.push("/(app)/log-match") }
            : undefined
        }
      />
    );
  }

  return (
    <View style={[{ gap: spacing.x2 }, stale && styles.stale]}>
      {error ? (
        <ErrorCard
          message="Couldn't refresh the season stats. Showing the last copy."
          onRetry={reload}
          retrying={refreshing}
        />
      ) : null}

      {headlines.length > 0 ? (
        <View>
          <SectionLabel action={live ? <Tag tone="accent">LIVE</Tag> : undefined}>
            Headlines
          </SectionLabel>
          {isTablet ? (
            <Grid min={250} maxColumns={4} gap={spacing.md}>
              {headlines.map((view, index) => headlineCard(view, index))}
            </Grid>
          ) : (
            <HeadlineRail>
              {(width) => headlines.map((view, index) => headlineCard(view, index, width))}
            </HeadlineRail>
          )}
        </View>
      ) : null}

      {yearbook.length > 0 ? (
        <View>
          <SectionLabel
            action={
              <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                one title each
              </Txt>
            }
          >
            The yearbook
          </SectionLabel>
          <Grid min={isTablet ? 220 : 150} maxColumns={4} gap={spacing.md}>
            {yearbook.map((superlative, index) => (
              <Reveal key={superlative.playerId} index={index} style={{ flex: 1 }}>
                <YearbookCard
                  superlative={superlative}
                  player={players.get(superlative.playerId)}
                  name={name(superlative.playerId)}
                  you={superlative.playerId === youId}
                  compact={!isTablet}
                  onPress={() => onOpen(superlative.playerId)}
                />
              </Reveal>
            ))}
          </Grid>
        </View>
      ) : null}

      {callouts.feuds.length > 0 || streaks.length > 0 ? (
        <Columns ratio={[1, 1]} gap={spacing.x2}>
          {callouts.feuds.length > 0 ? (
            <View>
              <SectionLabel>Feuds</SectionLabel>
              <View style={{ gap: spacing.md }}>
                {callouts.feuds.map((feud, index) => (
                  <Reveal key={feud.key} index={index}>
                    <FeudCard
                      feud={feud}
                      a={players.get(feud.playerId)}
                      b={players.get(feud.otherId)}
                      short={short}
                      onPress={() => openH2h(feud.playerId, feud.otherId)}
                    />
                  </Reveal>
                ))}
              </View>
            </View>
          ) : null}
          {streaks.length > 0 ? (
            <View>
              <SectionLabel>Hot & cold</SectionLabel>
              <Reveal>
                <StreakBoard streaks={streaks} live={live} players={players} onOpen={onOpen} />
              </Reveal>
            </View>
          ) : null}
        </Columns>
      ) : null}

      {hasNerdStats ? (
        <NerdCorner open={nerdOpen} onToggle={() => setNerdOpen((open) => !open)}>
          <NerdBoards stats={stats} players={players} onOpen={onOpen} />
        </NerdCorner>
      ) : null}
    </View>
  );
}

// --- Callout cards ---------------------------------------------------------------------

function IconTile({ icon, accent, size }: { icon: IconName; accent: string; size: number }) {
  return (
    <View
      style={[
        styles.iconTile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          backgroundColor: withAlpha(accent, 0.14),
          borderColor: withAlpha(accent, 0.32),
        },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} color={accent} />
    </View>
  );
}

/** Phones: the headlines as a swipeable rail that bleeds to the screen edges, the next
 *  card peeking in so it reads as scrollable. */
function HeadlineRail({ children }: { children: (cardWidth: number) => ReactNode }) {
  const gutter = useGutter();
  const { width } = useBreakpoint();
  const cardWidth = Math.min(340, width - gutter * 2 - 40);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + spacing.md}
      decelerationRate="fast"
      style={{ marginHorizontal: -gutter }}
      contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.md }}
    >
      {children(cardWidth)}
    </ScrollView>
  );
}

function HeadlineCard({
  view,
  player,
  other,
  names,
  onPress,
}: {
  view: HeadlineView;
  player: LeaguePlayer | undefined;
  other: LeaguePlayer | undefined;
  names: [string, string | null];
  onPress: () => void;
}) {
  const { text } = view;
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${text.title}. ${text.line}`}
      lift
      pressScale={0.99}
      style={[
        styles.headline,
        {
          borderColor: withAlpha(text.accent, 0.35),
          backgroundColor: mix(colors.surface, text.accent, 6),
        },
      ]}
      hoverStyle={{ borderColor: withAlpha(text.accent, 0.65) }}
    >
      <View style={styles.headlineTop}>
        <IconTile icon={text.icon} accent={text.accent} size={30} />
        <Txt
          variant="head"
          size={10.5}
          color={text.accent}
          numberOfLines={1}
          style={[styles.kicker, { flex: 1 }]}
        >
          {text.title.toUpperCase()}
        </Txt>
      </View>
      <View style={styles.headlineStat}>
        <Txt variant="monoBold" size={34} style={{ letterSpacing: -1 }}>
          {text.stat}
        </Txt>
        <Txt size={11.5} color={colors.textDim} style={{ flexShrink: 1 }}>
          {text.statLabel}
        </Txt>
      </View>
      <Txt variant="bodyMedium" size={13.5} style={styles.headlineLine}>
        {text.line}
      </Txt>
      <View style={styles.headlineFoot}>
        <View style={styles.pair}>
          <Avatar player={player} size={22} />
          {other ? (
            <View style={styles.pairSecond}>
              <Avatar player={other} size={22} />
            </View>
          ) : null}
        </View>
        <Txt size={11.5} color={colors.textDim} numberOfLines={1} style={{ flex: 1 }}>
          {names[1] ? `${names[0]} vs ${names[1]}` : names[0]}
        </Txt>
        {view.date ? (
          <Txt size={11} color={colors.textFaint}>
            {shortDate(view.date)}
          </Txt>
        ) : null}
      </View>
    </Interactive>
  );
}

function YearbookCard({
  superlative,
  player,
  name,
  you,
  compact,
  onPress,
}: {
  superlative: Superlative;
  player: LeaguePlayer | undefined;
  name: string;
  you: boolean;
  /** Phones: two to a row, so the blurb drops and everything shrinks a notch. */
  compact: boolean;
  onPress: () => void;
}) {
  const text = superlativeText(superlative);
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${name}: ${text.title}. ${text.stat} ${text.statLabel}`}
      lift
      pressScale={0.99}
      style={[styles.yearbook, you && { borderColor: withAlpha(colors.accent, 0.55) }]}
      hoverStyle={you ? undefined : { borderColor: colors.lineStrong }}
    >
      <View style={styles.yearbookHead}>
        <Avatar player={player} size={compact ? 30 : 38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyMedium" size={14} numberOfLines={1}>
            {name}
          </Txt>
          <View style={styles.metaLine}>
            {you ? <Tag tone="accent">YOU</Tag> : null}
            <Txt size={11} color={colors.textFaint}>
              {superlative.games} {superlative.games === 1 ? "game" : "games"}
            </Txt>
          </View>
        </View>
        {compact ? null : <IconTile icon={text.icon} accent={text.accent} size={32} />}
      </View>
      <View style={{ gap: 3 }}>
        <View style={styles.titleLine}>
          {compact ? <Icon name={text.icon} size={15} color={text.accent} /> : null}
          <Txt
            variant="head"
            size={compact ? 15 : 17}
            color={text.accent}
            style={{ flexShrink: 1 }}
          >
            {text.title}
          </Txt>
        </View>
        {compact ? null : (
          <Txt size={12} color={colors.textDim} numberOfLines={2} style={{ lineHeight: 16 }}>
            {text.line}
          </Txt>
        )}
      </View>
      <View style={styles.yearbookStat}>
        <Txt variant="monoBold" size={compact ? 17 : 19}>
          {text.stat}
        </Txt>
        <Txt size={11} color={colors.textDim} numberOfLines={2} style={{ flexShrink: 1 }}>
          {text.statLabel}
        </Txt>
      </View>
    </Interactive>
  );
}

function FeudCard({
  feud,
  a,
  b,
  short,
  onPress,
}: {
  feud: Feud;
  a: LeaguePlayer | undefined;
  b: LeaguePlayer | undefined;
  short: (uid: string) => string;
  onPress: () => void;
}) {
  const text = feudText(feud, short);
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${text.title}: ${short(feud.playerId)} ${text.stat} ${short(feud.otherId)}. ${text.line} Open head-to-head`}
      lift
      pressScale={0.99}
      style={styles.feud}
      hoverStyle={{ borderColor: colors.lineStrong }}
    >
      <View style={styles.headlineTop}>
        <IconTile icon={text.icon} accent={text.accent} size={26} />
        <Txt variant="head" size={10.5} color={text.accent} style={[styles.kicker, { flex: 1 }]}>
          {text.title.toUpperCase()}
        </Txt>
        <Txt variant="monoBold" size={11} color={colors.textFaint}>
          {feud.games} games
        </Txt>
      </View>
      <View style={styles.feudVs}>
        <View style={styles.feudSide}>
          <Avatar player={a} size={34} />
          <Txt variant="bodyMedium" size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
            {short(feud.playerId)}
          </Txt>
        </View>
        <View style={styles.feudScore}>
          <Txt variant="monoBold" size={20}>
            {text.stat}
          </Txt>
          <Txt variant="head" size={9} color={colors.textFaint} style={styles.kicker}>
            {text.statLabel}
          </Txt>
        </View>
        <View style={[styles.feudSide, styles.feudSideRight]}>
          <Txt variant="bodyMedium" size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
            {short(feud.otherId)}
          </Txt>
          <Avatar player={b} size={34} />
        </View>
      </View>
      <Txt size={12.5} color={colors.textDim} style={{ lineHeight: 17 }}>
        {text.line}
      </Txt>
    </Interactive>
  );
}

function StreakBoard({
  streaks,
  live,
  players,
  onOpen,
}: {
  streaks: StreakRow[];
  live: boolean;
  players: Map<string, LeaguePlayer>;
  onOpen: (uid: string) => void;
}) {
  return (
    <StatBoard title="Streaks" caption={live ? "right now" : "at the final whistle"} icon="flame">
      {streaks.map((row) => {
        // Rows are built as either hot (current win streak) or cold (winless run).
        const hot = row.winStreak >= 2;
        const player = players.get(row.playerId);
        return (
          <BoardRow
            key={row.playerId}
            player={player}
            name={player?.name ?? "Former player"}
            lead={
              <Icon
                name={hot ? "flame" : "bolt"}
                size={16}
                color={hot ? colors.win : colors.loss}
              />
            }
            detail={hot ? "Wins in a row" : "Games without a win"}
            value={hot ? `W${row.winStreak}` : `${row.winlessRun}`}
            valueColor={hot ? colors.win : colors.loss}
            onPress={() => onOpen(row.playerId)}
          />
        );
      })}
    </StatBoard>
  );
}

// --- Nerd corner -----------------------------------------------------------------------

function NerdCorner({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View>
      <Interactive
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Nerd corner: xG, shots and possession"
        pressScale={0.99}
        style={styles.nerdHead}
        hoverStyle={{ backgroundColor: colors.surface2, borderColor: colors.lineStrong }}
      >
        <IconTile icon="target" accent={colors.accent} size={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={14.5}>
            Nerd corner
          </Txt>
          <Txt size={12} color={colors.textDim} numberOfLines={2}>
            xG, shot volume and possession from match screenshots
          </Txt>
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={16} color={colors.textDim} />
        </View>
      </Interactive>
      {open ? <View style={{ marginTop: spacing.lg }}>{children}</View> : null}
    </View>
  );
}

/** The AI-extracted boards. Only shown inside the Nerd corner, so only when it's open. */
function NerdBoards({
  stats,
  players,
  onOpen,
}: {
  stats: SeasonLeaderboardStats;
  players: Map<string, LeaguePlayer>;
  onOpen: (uid: string) => void;
}) {
  const name = (uid: string) => players.get(uid)?.name ?? "Unknown player";
  const boards: ReactNode[] = [];
  if (stats.clinical.length > 0) {
    boards.push(
      <StatBoard
        key="clinical"
        title="Clinical finishers"
        caption="goals − xG"
        icon="target"
        footnote={
          stats.playersWithoutXg.length > 0
            ? `No xG data yet: ${stats.playersWithoutXg.map(name).join(", ")}`
            : undefined
        }
      >
        {stats.clinical.map((row, index) => (
          <BoardRow
            key={row.playerId}
            rank={index + 1}
            player={players.get(row.playerId)}
            name={name(row.playerId)}
            detail={`${row.goals} goal${row.goals === 1 ? "" : "s"} · ${fmtXg(row.xg)} xG · ${row.games} game${row.games === 1 ? "" : "s"}`}
            value={signed(row.delta)}
            valueColor={row.delta >= 0 ? colors.win : colors.loss}
            onPress={() => onOpen(row.playerId)}
          />
        ))}
      </StatBoard>,
    );
  }
  if (stats.shotVolume.length > 0) {
    boards.push(
      <StatBoard key="shots" title="Shot volume" caption="on target %" icon="crosshair">
        {stats.shotVolume.map((row, index) => (
          <BoardRow
            key={row.playerId}
            rank={index + 1}
            player={players.get(row.playerId)}
            name={name(row.playerId)}
            detail={`${row.shotsOnTarget}/${row.shots} on target · ${row.games} game${row.games === 1 ? "" : "s"}`}
            value={row.accuracyPct == null ? "—" : `${row.accuracyPct}%`}
            valueColor={colors.accent}
            bar={row.accuracyPct ?? 0}
            barDelay={index * 60}
            onPress={() => onOpen(row.playerId)}
          />
        ))}
      </StatBoard>,
    );
  }
  if (stats.possession.length > 0) {
    boards.push(
      <StatBoard key="possession" title="Possession kings" caption="avg %" icon="ball">
        {stats.possession.map((row, index) => (
          <BoardRow
            key={row.playerId}
            rank={index + 1}
            player={players.get(row.playerId)}
            name={name(row.playerId)}
            detail={`across ${row.games} game${row.games === 1 ? "" : "s"}`}
            value={`${row.averagePct}%`}
            valueColor={colors.accent}
            bar={Math.min(row.averagePct, 100)}
            barDelay={index * 60}
            onPress={() => onOpen(row.playerId)}
          />
        ))}
      </StatBoard>,
    );
  }
  return (
    <>
      <Grid min={380} maxColumns={2} gap={spacing.lg}>
        {boards.map((board, index) => (
          <Reveal key={index} index={index} style={{ flex: 1 }}>
            {board}
          </Reveal>
        ))}
      </Grid>
      <Txt size={12} color={colors.textFaint} style={styles.statsCaption}>
        These numbers come from AI-extracted match screenshots and are optional, so coverage varies
        between players and games.
      </Txt>
    </>
  );
}

// --- Boards ----------------------------------------------------------------------------

function StatBoard({
  title,
  caption,
  icon,
  footnote,
  children,
}: {
  title: string;
  caption: string;
  icon: IconName;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <Card padded={false} style={styles.board}>
      <View style={styles.boardHead}>
        <Icon name={icon} size={16} color={colors.accent} />
        <Txt variant="head" size={14.5} style={{ flex: 1 }}>
          {title}
        </Txt>
        <Txt variant="monoBold" size={11} color={colors.textFaint}>
          {caption}
        </Txt>
      </View>
      <View style={styles.boardRows}>{children}</View>
      {footnote ? (
        <Txt size={11.5} color={colors.textFaint} style={styles.boardFootnote}>
          {footnote}
        </Txt>
      ) : null}
    </Card>
  );
}

function BoardRow({
  rank,
  lead,
  player,
  name,
  detail,
  value,
  valueColor,
  bar,
  barDelay = 0,
  onPress,
}: {
  rank?: number;
  lead?: ReactNode;
  player: LeaguePlayer | undefined;
  name: string;
  detail: string;
  value: string;
  valueColor: string;
  /** 0–100 meter under the detail line. */
  bar?: number;
  barDelay?: number;
  onPress: () => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${name}, ${value}. ${detail}`}
      pressScale={0.99}
      style={styles.boardRow}
      hoverStyle={{ backgroundColor: colors.surface2 }}
    >
      <View style={styles.boardLead}>
        {lead ?? (
          <Txt variant="monoBold" size={12} color={colors.textFaint}>
            {rank}
          </Txt>
        )}
      </View>
      <Avatar player={player} size={28} />
      <View style={styles.boardMain}>
        <Txt variant="bodyMedium" size={14} numberOfLines={1}>
          {name}
        </Txt>
        <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
          {detail}
        </Txt>
        {bar !== undefined ? (
          <GrowBar value={bar / 100} height={4} delay={240 + barDelay} style={{ marginTop: 5 }} />
        ) : null}
      </View>
      <Txt variant="monoBold" size={15} color={valueColor} style={styles.boardValue}>
        {value}
      </Txt>
    </Interactive>
  );
}

export function StatsSkeleton() {
  return (
    <View style={{ gap: spacing.x2 }}>
      <Grid min={250} maxColumns={4} gap={spacing.md}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} height={196} />
        ))}
      </Grid>
      <Grid min={220} maxColumns={4} gap={spacing.md}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} height={172} />
        ))}
      </Grid>
    </View>
  );
}

const styles = StyleSheet.create({
  stale: { opacity: 0.5 },
  kicker: { letterSpacing: 1.1 },
  iconTile: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headline: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  headlineTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headlineStat: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  headlineLine: { lineHeight: 19, flexGrow: 1 },
  headlineFoot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pair: { flexDirection: "row", alignItems: "center" },
  pairSecond: {
    marginLeft: -7,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  yearbook: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  yearbookHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  yearbookStat: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: "auto",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  feud: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  feudVs: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  feudSide: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  feudSideRight: { justifyContent: "flex-end" },
  feudScore: { alignItems: "center", paddingHorizontal: spacing.xs },
  nerdHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  board: { flex: 1, overflow: "hidden" },
  boardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  boardRows: { paddingVertical: 4 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
  },
  boardLead: { width: 18, alignItems: "center" },
  boardMain: { flex: 1, minWidth: 0, gap: 1 },
  boardValue: { minWidth: 48, textAlign: "right" },
  boardFootnote: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  statsCaption: { marginTop: spacing.lg, marginHorizontal: 2, lineHeight: 17 },
});
