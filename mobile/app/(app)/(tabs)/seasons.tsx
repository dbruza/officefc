/**
 * Seasons tab — the league's history. A slim live-season card (tap → the table) with
 * its recent results and awards, then the Hall of Fame: one champion card per finished
 * season, each linking to its recap and final table.
 *
 * The live season and the archive load independently, so the live card never waits on
 * the per-season archive reads (four queries per past season).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import {
  Avatar,
  AwardCard,
  Button,
  Card,
  Columns,
  CountUp,
  EmptyState,
  ErrorCard,
  Grid,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SeasonMatchRow,
  SectionLabel,
  SkeletonCard,
  Tag,
  Txt,
  type IconName,
} from "@/components";
import { GrowBar } from "@/components/GrowBar";
import {
  getLeaguePlayers,
  getRecentSeasonMatches,
  getSeasonSummary,
  getSeasonPotm,
  getSeasonResult,
  getSeasons,
  getStandings,
  type LeagueMatch,
  type LeaguePlayer,
  type PotmResult,
  type Season,
  type SeasonResult,
} from "@/lib/league";
import { AWARD_META, type SeasonAward } from "@/lib/awards";
import { useBreakpoint } from "@/lib/responsive";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { webStyle, webTransition } from "@/lib/web";
import { colors, elevation, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface PastSeason {
  season: Season;
  result: SeasonResult | null;
  potm: PotmResult[];
  thirdId: string | null;
  awards: SeasonAward[];
}

interface LiveData {
  seasons: Season[];
  players: Map<string, LeaguePlayer>;
  matches: LeagueMatch[];
  awards: SeasonAward[];
  matchCount: number;
}

const RESULTS_PREVIEW = 5;
const RESULTS_MAX = 12;
/** Hall of Fame tiles per row at full width. */
const HALL_COLUMNS = 3;
const DAY_MS = 86_400_000;

export default function SeasonsRoute() {
  const router = useRouter();
  const { isTablet } = useBreakpoint();
  const [showAllResults, setShowAllResults] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useTabRetap("seasons", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  // Live season: the season list, roster and the live season's matches.
  const live = useFocusData<LiveData>(
    "seasons:live",
    useCallback(async () => {
      const [seasonRows, roster] = await Promise.all([getSeasons(), getLeaguePlayers()]);
      const activeSeason = seasonRows.find((season) => season.active) ?? null;
      const summary = activeSeason ? await getSeasonSummary(activeSeason.id) : null;
      return {
        awards: summary?.awards ?? [],
        matchCount: summary?.matchCount ?? 0,
        seasons: seasonRows,
        players: new Map(roster.map((player) => [player.id, player])),
        matches: activeSeason ? await getRecentSeasonMatches(activeSeason.id) : [],
      };
    }, []),
  );

  // Archive: fetched in parallel (it re-reads the small season list itself) so the
  // live card renders as soon as its own data lands.
  const archive = useFocusData<PastSeason[]>(
    "seasons:archive",
    useCallback(async () => {
      const seasonRows = await getSeasons();
      return Promise.all(
        seasonRows
          .filter((season) => !season.active)
          .map(async (season) => {
            const result = await getSeasonResult(season.id);
            const [potm, frozen, summary] = await Promise.all([
              result?.potm ? Promise.resolve(result.potm) : getSeasonPotm(season.id),
              result?.thirdId !== undefined ? Promise.resolve([]) : getStandings(season.id),
              result?.awards
                ? Promise.resolve({ awards: result.awards })
                : getSeasonSummary(season.id),
            ]);
            return {
              season,
              result,
              potm,
              // Third = best-placed finisher who isn't already champion or runner-up —
              // in a finals season the table's #3 can be the champion themselves.
              thirdId:
                result?.thirdId !== undefined
                  ? result.thirdId
                  : (frozen.find(
                      (standing) =>
                        standing.ranked &&
                        standing.uid !== result?.championId &&
                        standing.uid !== result?.runnerUpId,
                    )?.uid ?? null),
              awards: summary.awards,
            };
          }),
      );
    }, []),
  );

  const players = live.data?.players;
  const active = live.data?.seasons.find((season) => season.active) ?? null;
  const matches = useMemo(() => live.data?.matches ?? [], [live.data]);
  const recent = useMemo(() => matches.slice().reverse(), [matches]);
  const awards = live.data?.awards ?? [];
  const shownResults = recent.slice(0, showAllResults ? RESULTS_MAX : RESULTS_PREVIEW);
  const moreCount = Math.min(RESULTS_MAX, recent.length) - RESULTS_PREVIEW;

  const refreshing = live.refreshing || archive.refreshing;
  const reloadAll = () => void Promise.all([live.reload(), archive.reload()]);

  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);
  const openLeaderboard = () => router.navigate("/(app)/(tabs)/leaderboard");

  // --- Live season ---
  let liveSection: ReactNode;
  if (!live.data) {
    liveSection = live.error ? (
      <ErrorCard
        message="Couldn't load the current season. Check the connection and retry."
        onRetry={() => void live.reload()}
        retrying={live.refreshing}
      />
    ) : (
      <SkeletonCard height={154} />
    );
  } else if (!active) {
    liveSection = (
      <EmptyState
        compact
        icon="calendar"
        title="Between seasons"
        body="The next season hasn't kicked off yet. Last season's silverware is below."
      />
    );
  } else {
    liveSection = (
      <Reveal>
        <LiveSeasonCard
          season={active}
          played={live.data?.matchCount ?? 0}
          onPress={active.phase === "finals" ? () => router.push("/(app)/finals") : openLeaderboard}
        />
      </Reveal>
    );
  }

  const resultsBlock =
    players && recent.length > 0 ? (
      <View>
        <SectionLabel>Recent results</SectionLabel>
        <View style={{ gap: 7 }}>
          {shownResults.map((match, index) => {
            const playerA = players.get(match.aId);
            const playerB = players.get(match.bId);
            if (!playerA || !playerB) return null;
            return (
              <Reveal key={match.id} index={index} from="up">
                <SeasonMatchRow
                  match={match}
                  playerA={playerA}
                  playerB={playerB}
                  onPress={() => openMatch(match.id)}
                />
              </Reveal>
            );
          })}
          {moreCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              icon={showAllResults ? "minus" : "plus"}
              onPress={() => setShowAllResults((value) => !value)}
              style={styles.showMore}
            >
              {showAllResults ? "Show fewer" : `Show ${moreCount} more`}
            </Button>
          ) : null}
        </View>
      </View>
    ) : null;

  const awardsBlock =
    players && awards.length > 0 ? (
      <View>
        <SectionLabel action={<Tag tone="accent">LIVE</Tag>}>Season awards</SectionLabel>
        <View style={{ gap: spacing.sm }}>
          {awards.map((award, index) => (
            <Reveal key={award.key} index={index} from="up">
              <AwardCard
                award={award}
                winner={players.get(award.playerId)}
                onPress={(item) => (item.matchId ? openMatch(item.matchId) : undefined)}
              />
            </Reveal>
          ))}
        </View>
      </View>
    ) : null;

  // --- Hall of Fame ---
  const past = archive.data ?? [];
  let hallOfFame: ReactNode;
  if (!archive.data || !players) {
    hallOfFame = archive.error ? (
      <ErrorCard
        message="Couldn't load past seasons. Check the connection and retry."
        onRetry={() => void archive.reload()}
        retrying={archive.refreshing}
      />
    ) : (
      <Grid min={280} maxColumns={HALL_COLUMNS} gap={spacing.md}>
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} height={250} />
        ))}
      </Grid>
    );
  } else if (past.length === 0) {
    hallOfFame = (
      <EmptyState
        icon="crown"
        title="History starts here"
        body="When a season is finalized, its champion takes a place in the Hall of Fame."
      />
    );
  } else {
    hallOfFame = (
      <Grid min={280} maxColumns={HALL_COLUMNS} gap={spacing.md}>
        {past.map((item, index) => (
          <Reveal key={item.season.id} index={index} from="up" style={{ flex: 1 }}>
            <PastSeasonCard
              item={item}
              players={players}
              onOpen={() =>
                router.push({
                  pathname: "/(app)/archive/[id]",
                  params: { id: item.season.id },
                } as Href)
              }
              onRecap={() => router.push(`/(app)/recap/${item.season.id}` as Href)}
            />
          </Reveal>
        ))}
        {/* Grid collapses to the item count; spacers keep one or two champions at
            tile width instead of stretching across the page. */}
        {Array.from({ length: isTablet ? Math.max(0, HALL_COLUMNS - past.length) : 0 }, (_, i) => (
          <View key={`spacer-${i}`} />
        ))}
      </Grid>
    );
  }

  return (
    <Page
      edges={["top"]}
      scrollRef={scrollRef}
      refreshing={refreshing}
      onRefresh={reloadAll}
      header={
        <ScreenHeader
          title="Seasons"
          subtitle="Hall of Fame & silverware"
          back={false}
          onRefresh={reloadAll}
          refreshing={refreshing}
        />
      }
    >
      {liveSection}

      {resultsBlock || awardsBlock ? (
        <Columns gap={spacing.x2} style={{ marginTop: spacing.x2 }}>
          {resultsBlock}
          {awardsBlock}
        </Columns>
      ) : active && live.data && !live.refreshing ? (
        <EmptyState
          compact
          icon="ball"
          title="No results yet this season"
          body="Confirmed matches and season awards show up here."
          action={{
            label: "Log match",
            icon: "plus",
            onPress: () => router.push("/(app)/log-match"),
          }}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}

      <View style={{ marginTop: spacing.x3 }}>
        <SectionLabel
          action={
            archive.data && past.length > 0 ? (
              <Txt variant="monoBold" size={11} color={colors.textDim}>
                {past.length} season{past.length === 1 ? "" : "s"}
              </Txt>
            ) : undefined
          }
        >
          Hall of Fame
        </SectionLabel>
        {hallOfFame}
      </View>
    </Page>
  );
}

// --- Live season card ----------------------------------------------------------

function LiveSeasonCard({
  season,
  played,
  onPress,
}: {
  season: Season;
  played: number;
  onPress: () => void;
}) {
  const now = Date.now();
  const totalDays = Math.max(
    1,
    Math.round((season.end.getTime() - season.start.getTime()) / DAY_MS),
  );
  const daysLeft = Math.max(0, Math.ceil((season.end.getTime() - now) / DAY_MS));
  const day = Math.min(totalDays, Math.max(0, totalDays - daysLeft));
  const progress = day / totalDays;
  const finals = season.phase === "finals";
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${season.name}, ${finals ? "finals live" : "live season"}, ${daysLeft} days left. ${finals ? "Open the finals bracket" : "Open the league table"}`}
      style={styles.live}
    >
      <View style={styles.liveTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={10.5} color={colors.accent} style={styles.kicker}>
            {finals ? "● FINALS LIVE" : "● LIVE SEASON"}
          </Txt>
          <Txt variant="head" size={22} numberOfLines={1} style={{ marginTop: 3 }}>
            {season.name}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }} numberOfLines={1}>
            {formatRange(season)} · {played} match{played === 1 ? "" : "es"} played
          </Txt>
        </View>
        <View style={styles.daysLeft}>
          <CountUp value={daysLeft} from={0} variant="monoBold" size={30} color={colors.accent} />
          <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
            DAYS LEFT
          </Txt>
        </View>
      </View>
      <GrowBar value={progress} height={6} delay={250} duration={900} style={styles.progress} />
      <View style={styles.liveFoot}>
        <Txt size={11.5} color={colors.textDim}>
          Day {day} of {totalDays} · {Math.round(progress * 100)}% through
        </Txt>
        <View style={styles.liveCta}>
          <Txt variant="bodyMedium" size={12} color={colors.accent}>
            {finals ? "Open bracket" : "View table"}
          </Txt>
          <Icon name="arrowRight" size={14} color={colors.accent} />
        </View>
      </View>
    </Card>
  );
}

// --- Hall of Fame card ---------------------------------------------------------

function PastSeasonCard({
  item,
  players,
  onOpen,
  onRecap,
}: {
  item: PastSeason;
  players: Map<string, LeaguePlayer>;
  onOpen: () => void;
  onRecap: () => void;
}) {
  const { season, result, potm, thirdId, awards } = item;
  // The card is a plain container holding two sibling pressables (final table, recap)
  // — nesting them would be invalid HTML on web — so hover is lifted to the card here.
  const [hovered, setHovered] = useState(false);
  const hover = {
    onHoverIn: () => setHovered(true),
    onHoverOut: () => setHovered(false),
  };
  const champion = result ? players.get(result.championId) : undefined;
  const runnerUp = result ? players.get(result.runnerUpId) : undefined;
  const third = thirdId ? players.get(thirdId) : undefined;

  return (
    <View style={[styles.past, webTransition, hovered && styles.pastHover]}>
      <Interactive
        {...hover}
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={`${season.name} ${season.year}${champion ? `, champion ${champion.name}` : ""}. Open the final table`}
        pressScale={0.99}
        style={styles.pastMain}
      >
        <View style={styles.pastHeading}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={16} numberOfLines={1}>
              {season.name}
            </Txt>
            <Txt size={11.5} color={colors.textDim}>
              {formatRange(season)} · {season.year}
            </Txt>
          </View>
          <Icon name="chevron" size={17} color={hovered ? colors.gold : colors.textDim} />
        </View>
        {champion ? (
          <View style={styles.champion}>
            <Avatar player={champion} size={46} champion />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.championKicker}>
                <Icon name="trophy" size={12} color={colors.gold} />
                <Txt variant="head" size={9.5} color={colors.gold} style={styles.kicker}>
                  CHAMPION
                </Txt>
              </View>
              <Txt variant="head" size={17} numberOfLines={1}>
                {champion.name}
              </Txt>
              {result?.format === "finals" ? (
                <Txt size={11} color={colors.textDim}>
                  Won the Grand Final
                </Txt>
              ) : null}
            </View>
          </View>
        ) : (
          <Txt size={12} color={colors.textDim} style={{ marginBottom: spacing.sm }}>
            Final result pending.
          </Txt>
        )}
        {runnerUp || third ? (
          <View style={styles.placings}>
            <Placing label="Runner-up" player={runnerUp} icon="medal" color={colors.silver} />
            <Placing label="Third" player={third} icon="medal" color={colors.bronze} />
          </View>
        ) : null}
      </Interactive>

      {result ? (
        <Interactive
          {...hover}
          onPress={onRecap}
          accessibilityRole="link"
          accessibilityLabel={`Season recap for ${season.name}`}
          pressScale={0.98}
          style={styles.recap}
          hoverStyle={{ backgroundColor: mix(colors.surface2, colors.gold, 10) }}
        >
          <Icon name="sparkle" size={15} color={colors.gold} />
          <Txt variant="bodyMedium" size={12.5} style={{ flex: 1 }}>
            Season recap
          </Txt>
          <Icon name="arrowRight" size={14} color={colors.textDim} />
        </Interactive>
      ) : null}

      {awards.length || potm.length ? (
        <View style={styles.pastFoot}>
          {awards.length ? (
            <View style={styles.awardPills}>
              {awards.slice(0, 3).map((award) => {
                const meta = AWARD_META[award.key];
                const winner = players.get(award.playerId);
                return winner ? (
                  <View
                    key={award.key}
                    style={styles.awardPill}
                    accessible
                    accessibilityLabel={`${meta.title}: ${winner.name}`}
                  >
                    <Icon name={meta.icon} size={13} color={meta.accent} />
                    <Txt variant="bodyMedium" size={11}>
                      {firstName(winner.name)}
                    </Txt>
                  </View>
                ) : null;
              })}
              {awards.length > 3 ? (
                <Txt size={11} color={colors.textFaint}>
                  +{awards.length - 3} more
                </Txt>
              ) : null}
            </View>
          ) : null}
          {potm.length ? (
            <View style={styles.potmRow}>
              <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                POTM
              </Txt>
              {potm.map((month) => {
                const player = players.get(month.playerId);
                return player ? (
                  <View
                    key={month.month}
                    style={styles.potm}
                    accessible
                    accessibilityLabel={`Player of the month, ${monthLabel(month.month)}: ${player.name}`}
                  >
                    <Avatar player={player} size={20} />
                    <Txt variant="mono" size={10.5} color={colors.textDim}>
                      {monthLabel(month.month)}
                    </Txt>
                  </View>
                ) : null;
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Placing({
  label,
  player,
  icon,
  color,
}: {
  label: string;
  player: LeaguePlayer | undefined;
  icon: IconName;
  color: string;
}) {
  if (!player) return <View style={{ flex: 1 }} />;
  return (
    <View style={styles.placing}>
      <Avatar player={player} size={26} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.championKicker}>
          <Icon name={icon} size={11} color={color} />
          <Txt variant="head" size={8.5} color={colors.textDim} style={styles.kicker}>
            {label.toUpperCase()}
          </Txt>
        </View>
        <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
          {firstName(player.name)}
        </Txt>
      </View>
    </View>
  );
}

function formatRange(season: Season): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${format(season.start)} – ${format(season.end)}`;
}

/** "2026-04" → "Apr". Falls back to the raw id if it isn't a year-month. */
function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

const goldEdge = webStyle({
  boxShadow: `${elevation.hover}, 0 0 0 1px ${withAlpha(colors.gold, 0.25)}`,
});

const styles = StyleSheet.create({
  live: {
    borderRadius: radius.xl,
    borderColor: withAlpha(colors.accent, 0.22),
    backgroundColor: mix(colors.surface, colors.accent, 6),
  },
  liveTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  daysLeft: { alignItems: "flex-end" },
  kicker: { letterSpacing: 1.1 },
  progress: { marginTop: spacing.lg },
  liveFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  liveCta: { flexDirection: "row", alignItems: "center", gap: 4 },
  showMore: { alignSelf: "center", marginTop: 4 },
  past: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  pastHover: {
    borderColor: withAlpha(colors.gold, 0.55),
    transform: [{ translateY: -2 }],
    ...goldEdge,
  },
  pastMain: { padding: spacing.lg, paddingBottom: spacing.md },
  pastHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  champion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.22),
    borderRadius: radius.md,
    backgroundColor: mix(colors.surface, colors.gold, 6),
  },
  championKicker: { flexDirection: "row", alignItems: "center", gap: 4 },
  placings: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  placing: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  recap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.28),
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    marginBottom: spacing.lg,
  },
  pastFoot: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  awardPills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
  awardPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  potmRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  potm: { flexDirection: "row", alignItems: "center", gap: 4 },
});
