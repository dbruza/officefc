/**
 * League table tab. A season selector, a Table/Stats switch and player search sit in one
 * compact toolbar; the Table view leads with the podium, then the standings — card rows
 * on phones, a sortable data table on desktop. Stats swaps in the season's callouts
 * (headlines, a yearbook title per player, feuds) with the AI-extracted boards below.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { type Href, useRouter } from "expo-router";

import {
  Card,
  Columns,
  CountUp,
  EmptyState,
  ErrorCard,
  Icon,
  Interactive,
  Page,
  PlayerRow,
  Podium,
  Reveal,
  ScreenHeader,
  SectionLabel,
  Segmented,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  Txt,
  type IconName,
  type PodiumEntry,
} from "@/components";
import { GrowBar } from "@/components/GrowBar";
import { LeagueTable, type LeagueTableGroup, type LeagueTableRow } from "@/components/LeagueTable";
import { useAuth } from "@/lib/auth";
import {
  MIN_RANKED_GAMES,
  getLeaguePlayers,
  getSeasonResults,
  getSeasons,
  getStandings,
  type LeaguePlayer,
  type Season,
  type Standing,
} from "@/lib/league";
import { SeasonStatsBoard, StatsSkeleton } from "@/screens/SeasonStats";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

interface LeaderboardData {
  seasons: Season[];
  selectedId: string;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  championId: string | null;
}

/** Which view of the season the tab shows: the ELO table or the extracted-stats boards. */
type LeaderboardTab = "table" | "stats";

const TAB_OPTIONS: { value: LeaderboardTab; label: string; icon: IconName }[] = [
  { value: "table", label: "Table", icon: "list" },
  { value: "stats", label: "Stats", icon: "target" },
];

const DAY_MS = 86_400_000;

export default function Leaderboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDesktop } = useBreakpoint();
  // "" means "whatever season is active" until the user explicitly picks one.
  const [seasonId, setSeasonId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [tab, setTab] = useState<LeaderboardTab>("table");

  const { data, refreshing, error, stale, reload } = useFocusData<LeaderboardData>(
    `leaderboard:${seasonId || "active"}`,
    useCallback(async () => {
      const [seasonRows, roster, results] = await Promise.all([
        getSeasons(),
        getLeaguePlayers(),
        getSeasonResults(),
      ]);
      const selectedId =
        seasonId || seasonRows.find((season) => season.active)?.id || seasonRows[0]?.id || "";
      const selected = seasonRows.find((season) => season.id === selectedId);
      // The crown marks the reigning champion on the live table; on a past season it
      // belongs to whoever won THAT season, not the most recent champion.
      const championId =
        selected && !selected.active
          ? (results.find((result) => result.seasonId === selectedId)?.championId ?? null)
          : (results[0]?.championId ?? null);
      return {
        seasons: seasonRows,
        selectedId,
        standings: selectedId ? await getStandings(selectedId) : [],
        players: new Map(roster.map((player) => [player.id, player])),
        championId,
      };
    }, [seasonId]),
  );
  const seasons = useMemo(() => data?.seasons ?? [], [data]);
  const standings = useMemo(() => data?.standings ?? [], [data]);
  const players = useMemo(() => data?.players ?? new Map<string, LeaguePlayer>(), [data]);
  const championId = data?.championId ?? null;
  const activeSeasonId = seasons.find((season) => season.active)?.id ?? "";

  // What the user asked for drives the chips and the Stats boards immediately; the
  // table keeps showing (dimmed) whatever season its data belongs to until the switch lands.
  const requestedId = seasonId || data?.selectedId || "";
  const requestedSeason = seasons.find((season) => season.id === requestedId) ?? null;
  const shownSeason = seasons.find((season) => season.id === data?.selectedId) ?? null;
  const live = !!shownSeason?.active;

  // Picking the live season maps back to "" so it shares the default cache entry.
  const chooseSeason = (id: string) => setSeasonId(id === activeSeasonId ? "" : id);
  const openPlayer = (uid: string) => router.push(`/(app)/player/${uid}` as Href);
  const statsReload = useRef<(() => Promise<void>) | null>(null);
  // One refresh for the whole tab: the standings plus the Stats boards when they're open.
  const refreshAll = () => void Promise.all([reload(), statsReload.current?.()]);
  const scrollRef = useRef<ScrollView>(null);
  useTabRetap("leaderboard", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const q = queryText.trim().toLowerCase();
  const groups = useMemo(() => {
    const known = standings.filter((standing) => players.has(standing.uid));
    const ranked = known.filter((standing) => standing.ranked);
    // Placement and "no games yet" are live-season ideas; a finalized season shows only
    // the ranked table as its historical record.
    const placement = live ? known.filter((standing) => !standing.ranked) : [];
    const seen = new Set(standings.map((standing) => standing.uid));
    const unranked = live ? [...players.values()].filter((player) => !seen.has(player.id)) : [];
    return { ranked, placement, unranked };
  }, [live, players, standings]);
  // The headline count describes the season, not the current search.
  const total = groups.ranked.length + groups.placement.length + groups.unranked.length;

  const matchesQuery = useCallback(
    (uid: string) => !q || !!players.get(uid)?.name.toLowerCase().includes(q),
    [players, q],
  );
  const visible = useMemo(
    () => ({
      ranked: groups.ranked.filter((standing) => matchesQuery(standing.uid)),
      placement: groups.placement.filter((standing) => matchesQuery(standing.uid)),
      unranked: groups.unranked.filter((player) => matchesQuery(player.id)),
    }),
    [groups, matchesQuery],
  );
  const visibleCount = visible.ranked.length + visible.placement.length + visible.unranked.length;

  const podium: PodiumEntry[] = groups.ranked.slice(0, 3).flatMap((standing) => {
    const player = players.get(standing.uid);
    return player ? [{ player, elo: standing.elo }] : [];
  });
  const showPodium = tab === "table" && !q && podium.length >= 2;

  const subtitle = shownSeason
    ? `${total} contender${total === 1 ? "" : "s"} · ${shownSeason.name}`
    : "Season standings";

  const toolbar = (
    <View style={[styles.toolbar, isDesktop && styles.toolbarDesktop]}>
      <SeasonChips
        seasons={seasons}
        selectedId={requestedId}
        onSelect={chooseSeason}
        wrap={isDesktop}
        loading={!data}
      />
      <View style={[styles.toolbarRow, isDesktop && styles.toolbarRowDesktop]}>
        <Segmented
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          size="sm"
          full={false}
          style={styles.segmented}
        />
        {tab === "table" ? (
          <SearchField value={queryText} onChange={setQueryText} desktop={isDesktop} />
        ) : null}
      </View>
    </View>
  );

  const finalsBanner =
    requestedSeason?.active && requestedSeason.phase === "finals" ? (
      <Interactive
        onPress={() => router.push("/(app)/finals")}
        accessibilityRole="link"
        accessibilityLabel="Finals are live. Open the bracket"
        style={styles.finalsBanner}
        hoverStyle={{ backgroundColor: mix(colors.surface, colors.accent, 10) }}
        lift
      >
        <Icon name="trophy" size={20} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={14}>
            Finals are live
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            The table is locked — the bracket decides the champion.
          </Txt>
        </View>
        <Icon name="chevron" size={16} color={colors.textDim} />
      </Interactive>
    ) : null;

  let body: ReactNode;
  if (tab === "stats") {
    body = requestedId ? (
      <SeasonStatsBoard
        seasonId={requestedId}
        live={!!requestedSeason?.active}
        // The title race reads the table, which may still belong to the previous season.
        standings={data?.selectedId === requestedId ? standings : []}
        players={players}
        youId={user?.uid}
        onOpen={openPlayer}
        reloadRef={statsReload}
      />
    ) : error ? (
      <ErrorCard
        message="Couldn't load the seasons. Check the connection and retry."
        onRetry={reload}
      />
    ) : (
      <StatsSkeleton />
    );
  } else if (!data) {
    body = error ? (
      <ErrorCard
        message="Couldn't load the standings. Check the connection and retry."
        onRetry={reload}
        retrying={refreshing}
      />
    ) : (
      <TableSkeleton desktop={isDesktop} />
    );
  } else {
    const rowsFor = (list: Standing[], note?: (s: Standing) => string): LeagueTableRow[] =>
      list.flatMap((standing) => {
        const player = players.get(standing.uid);
        return player ? [{ player, standing, note: note?.(standing) }] : [];
      });
    const placementNote = (standing: Standing) => {
      const left = Math.max(1, MIN_RANKED_GAMES - (standing.w + standing.d + standing.l));
      return `${left} more game${left === 1 ? "" : "s"} to rank`;
    };
    const tableGroups: LeagueTableGroup[] = [
      { key: "ranked", rows: rowsFor(visible.ranked) },
      {
        key: "placement",
        title: "Placement",
        caption: `${MIN_RANKED_GAMES} games to qualify`,
        rows: rowsFor(visible.placement, placementNote),
      },
      {
        key: "unranked",
        title: "Unranked",
        caption: "No matches yet",
        rows: visible.unranked.map((player) => ({ player, standing: null })),
      },
    ];

    body = (
      <View style={stale && styles.stale}>
        {error ? (
          <ErrorCard
            message="Couldn't refresh the standings. Showing the last copy."
            onRetry={reload}
            retrying={refreshing}
            style={{ marginBottom: spacing.lg }}
          />
        ) : null}
        {showPodium ? (
          <View style={{ marginBottom: spacing.lg }}>
            {isDesktop && shownSeason ? (
              <Columns ratio={[3, 2]} gap={spacing.lg}>
                <Card style={styles.podiumCard}>
                  <View style={styles.podiumInner}>
                    <Podium entries={podium} onPick={openPlayer} />
                  </View>
                </Card>
                <SeasonSnapshot season={shownSeason} standings={standings} />
              </Columns>
            ) : (
              <Card style={styles.podiumCard}>
                <Podium entries={podium} onPick={openPlayer} />
              </Card>
            )}
          </View>
        ) : null}

        {total === 0 ? (
          <EmptyState
            icon="board"
            title="The table is waiting"
            body={
              shownSeason && !shownSeason.active
                ? "No standings were frozen for this season."
                : "Confirm the first result to start the season standings."
            }
            action={
              shownSeason?.active
                ? {
                    label: "Log a match",
                    icon: "plus",
                    onPress: () => router.push("/(app)/log-match"),
                  }
                : undefined
            }
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            compact
            icon="search"
            title={`No players match “${queryText.trim()}”`}
            body="Check the spelling, or clear the search to see the whole table."
            action={{ label: "Clear", onPress: () => setQueryText("") }}
          />
        ) : isDesktop ? (
          <LeagueTable
            groups={tableGroups}
            live={live}
            youId={user?.uid}
            championId={championId}
            onOpen={openPlayer}
          />
        ) : (
          <PhoneTable
            groups={tableGroups}
            live={live}
            youId={user?.uid}
            championId={championId}
            onOpen={openPlayer}
          />
        )}
      </View>
    );
  }

  return (
    <Page
      edges={["top"]}
      width="wide"
      scrollRef={scrollRef}
      refreshing={refreshing}
      onRefresh={refreshAll}
      header={
        <ScreenHeader
          title="Leaderboard"
          subtitle={subtitle}
          back={false}
          onRefresh={refreshAll}
          refreshing={refreshing}
        />
      }
    >
      {toolbar}
      {finalsBanner}
      {body}
    </Page>
  );
}

// --- Toolbar -----------------------------------------------------------------

/** Season picker: a single scrolling line on phones, wrapping chips on desktop. */
function SeasonChips({
  seasons,
  selectedId,
  onSelect,
  wrap,
  loading,
}: {
  seasons: Season[];
  selectedId: string;
  onSelect: (id: string) => void;
  wrap: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <View style={[styles.chipRow, wrap && styles.chipWrap]}>
        <Skeleton width={120} height={34} round={radius.pill} />
        <Skeleton width={136} height={34} round={radius.pill} />
      </View>
    );
  }
  const chips = seasons.map((season) => {
    const selected = season.id === selectedId;
    return (
      <Interactive
        key={season.id}
        onPress={() => onSelect(season.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        // RN-web ignores accessibilityState; aria-selected reaches the DOM.
        aria-selected={selected}
        accessibilityLabel={`${season.name}${season.active ? ", live season" : ""}`}
        pressScale={0.96}
        style={[styles.seasonChip, selected && styles.seasonChipActive]}
        hoverStyle={
          selected
            ? undefined
            : { backgroundColor: colors.surface2, borderColor: colors.lineStrong }
        }
      >
        {season.active ? <View style={styles.liveDot} /> : null}
        <Txt variant="bodyMedium" size={12.5} color={selected ? colors.accent : colors.textDim}>
          {season.name}
        </Txt>
      </Interactive>
    );
  });
  if (wrap) {
    return (
      <View accessibilityRole="tablist" style={[styles.chipRow, styles.chipWrap]}>
        {chips}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={styles.chipRow}
    >
      {chips}
    </ScrollView>
  );
}

function SearchField({
  value,
  onChange,
  desktop,
}: {
  value: string;
  onChange: (value: string) => void;
  desktop: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.search,
        searchTransition,
        desktop ? styles.searchDesktop : styles.searchPhone,
        focused && { borderColor: withAlpha(colors.accent, 0.55) },
      ]}
    >
      <Icon name="search" size={16} color={focused ? colors.accent : colors.textDim} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Web: Escape clears, like most search boxes.
        onKeyPress={(e) => {
          if (Platform.OS === "web" && e.nativeEvent.key === "Escape") onChange("");
        }}
        placeholder="Search players"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Search players"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.searchInput}
      />
      {value ? (
        <Interactive
          onPress={() => onChange("")}
          accessibilityLabel="Clear search"
          pressScale={0.9}
          hitSlop={8}
          style={styles.clear}
          hoverStyle={{ backgroundColor: colors.surface3 }}
        >
          <Icon name="x" size={13} stroke={2.4} color={colors.textDim} />
        </Interactive>
      ) : null}
    </View>
  );
}

// --- Table views ---------------------------------------------------------------

/** Phone/tablet standings: the card-row list, with placement + unranked groups below. */
function PhoneTable({
  groups,
  live,
  youId,
  championId,
  onOpen,
}: {
  groups: LeagueTableGroup[];
  live: boolean;
  youId?: string | null;
  championId: string | null;
  onOpen: (uid: string) => void;
}) {
  let index = 0;
  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <View key={group.key}>
            {group.title ? (
              <SectionLabel
                action={
                  group.caption ? (
                    <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                      {group.caption}
                    </Txt>
                  ) : undefined
                }
              >
                {group.title}
              </SectionLabel>
            ) : null}
            <View style={{ gap: spacing.sm }}>
              {group.rows.map(({ player, standing }) => {
                const ranked = !!standing?.ranked;
                return (
                  <Reveal key={player.id} index={index++} from="up">
                    <PlayerRow
                      player={player}
                      rank={ranked ? standing?.rank : undefined}
                      reserveRank={!ranked}
                      elo={standing?.elo}
                      move={ranked && live ? standing?.move : undefined}
                      form={ranked && live ? standing?.form : undefined}
                      record={
                        standing && !(ranked && live)
                          ? { w: standing.w, d: standing.d, l: standing.l }
                          : undefined
                      }
                      compact={!standing}
                      you={player.id === youId}
                      champion={player.id === championId}
                      onPress={() => onOpen(player.id)}
                    />
                  </Reveal>
                );
              })}
            </View>
          </View>
        ),
      )}
    </View>
  );
}

/** Desktop companion to the podium: the season's headline numbers. */
function SeasonSnapshot({ season, standings }: { season: Season; standings: Standing[] }) {
  const games = standings.reduce((sum, s) => sum + s.w + s.d + s.l, 0) / 2;
  const goals = standings.reduce((sum, s) => sum + s.gf, 0);
  const perGame = games ? goals / games : 0;
  const now = Date.now();
  const totalDays = Math.max(
    1,
    Math.round((season.end.getTime() - season.start.getTime()) / DAY_MS),
  );
  const daysLeft = Math.max(0, Math.ceil((season.end.getTime() - now) / DAY_MS));
  const elapsed = Math.min(totalDays, Math.max(0, totalDays - daysLeft));
  const tiles: { label: string; value: number; format?: (n: number) => string }[] = [
    { label: "Matches", value: Math.round(games) },
    { label: "Goals", value: goals },
    { label: "Goals / match", value: Math.round(perGame * 10), format: (n) => (n / 10).toFixed(1) },
    season.active
      ? { label: "Days left", value: daysLeft }
      : { label: "Players", value: standings.filter((s) => s.ranked).length },
  ];
  return (
    <Card style={styles.snapshot}>
      <Txt
        variant="head"
        size={10.5}
        color={season.active ? colors.accent : colors.textDim}
        style={styles.kicker}
      >
        {season.active ? "● LIVE SEASON" : "FINAL STANDINGS"}
      </Txt>
      <Txt variant="head" size={19} numberOfLines={1} style={{ marginTop: 4 }}>
        {season.name}
      </Txt>
      <View style={styles.snapshotGrid}>
        {tiles.map((tile) => (
          <View key={tile.label} style={styles.snapshotTile}>
            <CountUp
              value={tile.value}
              from={0}
              format={tile.format}
              variant="monoBold"
              size={24}
              style={{ letterSpacing: -0.5 }}
            />
            <Txt size={11.5} color={colors.textDim}>
              {tile.label}
            </Txt>
          </View>
        ))}
      </View>
      {season.active ? (
        <View style={{ marginTop: "auto", gap: 6 }}>
          <View style={styles.progressLabel}>
            <Txt size={11.5} color={colors.textDim}>
              Day {elapsed} of {totalDays}
            </Txt>
            <Txt variant="monoBold" size={11.5} color={colors.textDim}>
              {Math.round((elapsed / totalDays) * 100)}%
            </Txt>
          </View>
          <GrowBar value={elapsed / totalDays} height={6} delay={200} />
        </View>
      ) : null}
    </Card>
  );
}

function TableSkeleton({ desktop }: { desktop: boolean }) {
  return (
    <View style={{ gap: spacing.lg }}>
      {desktop ? (
        <Columns ratio={[3, 2]} gap={spacing.lg}>
          <SkeletonCard height={236} />
          <SkeletonCard height={236} />
        </Columns>
      ) : (
        <SkeletonCard height={226} />
      )}
      <SkeletonRows count={desktop ? 8 : 6} height={desktop ? 54 : 62} />
    </View>
  );
}

/** Web: ease the search box's border into its focus colour. */
const searchTransition = webStyle({
  transitionProperty: "border-color",
  transitionDuration: "160ms",
});

const styles = StyleSheet.create({
  toolbar: { gap: spacing.sm, marginBottom: spacing.lg },
  toolbarDesktop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginBottom: spacing.x2,
  },
  toolbarRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolbarRowDesktop: { gap: spacing.md },
  segmented: { flexShrink: 0 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chipWrap: { flex: 1, flexWrap: "wrap", minWidth: 0 },
  seasonChip: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  seasonChipActive: {
    borderColor: withAlpha(colors.accent, 0.6),
    backgroundColor: mix(colors.surface, colors.accent, 8),
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  search: {
    minWidth: 0,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchPhone: { flex: 1 },
  searchDesktop: { width: 260 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    color: colors.text,
    fontFamily: "Archivo_400Regular",
    fontSize: 13.5,
  },
  clear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  finalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  stale: { opacity: 0.5 },
  podiumCard: {
    paddingTop: spacing.lg,
    paddingBottom: 0,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  podiumInner: { width: "100%", maxWidth: 460, alignSelf: "center" },
  snapshot: { flex: 1, minHeight: 236, padding: spacing.xl },
  kicker: { letterSpacing: 1.1 },
  snapshotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  snapshotTile: { width: "50%", gap: 2 },
  progressLabel: { flexDirection: "row", justifyContent: "space-between" },
});
