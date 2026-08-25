import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { Button, Card, Icon, PlayerRow, ScreenHeader, SectionLabel, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { fmtXg } from "@/lib/format";
import {
  getLeaguePlayers,
  getSeasonResults,
  getSeasons,
  getStandings,
  type LeaguePlayer,
  type Season,
  type Standing,
} from "@/lib/league";
import {
  aggregateSeasonStats,
  type SeasonLeaderboardStats,
  type SeasonStatMatch,
} from "@/lib/stats/seasonStats";
import { currentWinStreak, currentWinlessRun } from "@/lib/stats/streaks";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { colors, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

interface LeaderboardData {
  seasons: Season[];
  selectedId: string;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  championId: string | null;
}

/** Which view of the season the tab shows: the ELO table or the extracted-stats boards. */
type LeaderboardTab = "table" | "stats";

export default function Leaderboard() {
  const router = useRouter();
  const { user } = useAuth();
  // "" means "whatever season is active" until the user explicitly picks one.
  const [seasonId, setSeasonId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [tab, setTab] = useState<LeaderboardTab>("table");

  const { data, loading, refreshing, error, reload } = useFocusData<LeaderboardData>(
    `leaderboard:${seasonId || "active"}`,
    useCallback(async () => {
      const [seasonRows, roster, results] = await Promise.all([
        getSeasons(),
        getLeaguePlayers(),
        getSeasonResults(),
      ]);
      const selectedId =
        seasonId || seasonRows.find((season) => season.active)?.id || seasonRows[0]?.id || "";
      return {
        seasons: seasonRows,
        selectedId,
        standings: selectedId ? await getStandings(selectedId) : [],
        players: new Map(roster.map((player) => [player.id, player])),
        championId: results[0]?.championId ?? null,
      };
    }, [seasonId]),
  );
  const seasons = data?.seasons ?? [];
  const standings = data?.standings ?? [];
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const championId = data?.championId ?? null;
  const activeSeasonId = data?.selectedId ?? "";

  const chooseSeason = (id: string) => setSeasonId(id);
  const scrollRef = useRef<ScrollView>(null);
  useTabRetap("leaderboard", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const selectedSeason = seasons.find((season) => season.id === activeSeasonId) ?? null;
  const visible = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return q
      ? standings.filter((standing) => players.get(standing.uid)?.name.toLowerCase().includes(q))
      : standings;
  }, [players, queryText, standings]);

  // Members without a confirmed match yet — shown below the table on the live season only;
  // past seasons stay a historical record of who actually played.
  const unranked = useMemo(() => {
    if (!selectedSeason?.active) return [];
    const q = queryText.trim().toLowerCase();
    const ranked = new Set(standings.map((standing) => standing.uid));
    return [...players.values()].filter(
      (player) => !ranked.has(player.id) && (!q || player.name.toLowerCase().includes(q)),
    );
  }, [players, queryText, selectedSeason, standings]);

  // Ranked players hold the table; provisional players (1–2 games) sit in a placement section.
  // Placement is a live-season concept — finalized seasons show only the ranked table.
  const rankedStandings = visible.filter((standing) => standing.ranked);
  const placement = selectedSeason?.active ? visible.filter((standing) => !standing.ranked) : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Leaderboard"
        subtitle={`${visible.length + unranked.length} contender${visible.length + unranked.length === 1 ? "" : "s"}${selectedSeason ? ` · ${selectedSeason.year}` : ""}`}
        back={false}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={colors.accent}
          />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.seasonScroll}
        >
          {seasons.map((season) => (
            <Pressable
              key={season.id}
              onPress={() => chooseSeason(season.id)}
              style={[styles.seasonChip, season.id === activeSeasonId && styles.seasonChipActive]}
            >
              <Txt
                variant="bodyMedium"
                size={12}
                color={season.id === activeSeasonId ? colors.accent : colors.textDim}
              >
                {season.name}
              </Txt>
              {season.active ? <View style={styles.liveDot} /> : null}
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.tabSwitch}>
          {(Object.keys(TAB_LABELS) as LeaderboardTab[]).map((key) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tabOption, tab === key && styles.tabOptionActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}
            >
              <Txt
                variant="bodyMedium"
                size={13}
                color={tab === key ? colors.onAccent : colors.textDim}
              >
                {TAB_LABELS[key]}
              </Txt>
            </Pressable>
          ))}
        </View>
        {selectedSeason?.active && selectedSeason.phase === "finals" ? (
          <Pressable
            onPress={() => router.push("/finals")}
            style={styles.finalsBanner}
            accessibilityRole="button"
          >
            <Icon name="trophy" size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Txt variant="head" size={14}>
                Finals are live
              </Txt>
              <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
                The table is locked — the bracket decides the champion.
              </Txt>
            </View>
            <Icon name="chevron" size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
        {tab === "stats" ? (
          <SeasonStatsBoard seasonId={activeSeasonId} players={players} />
        ) : (
          <>
            <View style={styles.search}>
              <Icon name="search" size={16} color={colors.textDim} />
              <TextInput
                value={queryText}
                onChangeText={setQueryText}
                placeholder="Search players"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
              />
            </View>
            {loading ? <ActivityIndicator color={colors.accent} /> : null}
            {error ? (
              <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
                <Txt color={colors.loss} size={13}>
                  Couldn't load the standings. Check the connection and retry.
                </Txt>
                <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
                  Retry
                </Button>
              </Card>
            ) : null}
            {!error &&
            !loading &&
            rankedStandings.length === 0 &&
            placement.length === 0 &&
            unranked.length === 0 ? (
              <Card style={{ alignItems: "center", paddingVertical: spacing.x3 }}>
                <Icon name="board" size={28} color={colors.textDim} />
                <Txt variant="head" size={17} style={{ marginTop: spacing.md }}>
                  The table is waiting
                </Txt>
                <Txt color={colors.textDim} style={{ marginTop: spacing.sm, textAlign: "center" }}>
                  Confirm the first result to start the season standings.
                </Txt>
              </Card>
            ) : null}
            <View style={{ gap: spacing.sm }}>
              {rankedStandings.map((standing) => {
                const player = players.get(standing.uid);
                if (!player) return null;
                return (
                  <PlayerRow
                    key={standing.uid}
                    player={player}
                    rank={standing.rank}
                    elo={standing.elo}
                    move={standing.move}
                    form={selectedSeason?.active ? standing.form : undefined}
                    record={
                      selectedSeason?.active
                        ? undefined
                        : { w: standing.w, d: standing.d, l: standing.l }
                    }
                    you={standing.uid === user?.uid}
                    champion={standing.uid === championId}
                    onPress={() => router.push(`/(app)/player/${standing.uid}`)}
                  />
                );
              })}
            </View>
            {placement.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <SectionLabel
                  action={
                    <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                      3 games to qualify
                    </Txt>
                  }
                >
                  Placement
                </SectionLabel>
                <View style={{ gap: spacing.sm }}>
                  {placement.map((standing) => {
                    const player = players.get(standing.uid);
                    if (!player) return null;
                    return (
                      <PlayerRow
                        key={standing.uid}
                        player={player}
                        elo={standing.elo}
                        record={{ w: standing.w, d: standing.d, l: standing.l }}
                        you={standing.uid === user?.uid}
                        champion={standing.uid === championId}
                        onPress={() => router.push(`/(app)/player/${standing.uid}`)}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
            {unranked.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <SectionLabel
                  action={
                    <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                      No matches yet
                    </Txt>
                  }
                >
                  Unranked
                </SectionLabel>
                <View style={{ gap: spacing.sm }}>
                  {unranked.map((player) => (
                    <PlayerRow
                      key={player.id}
                      player={player}
                      compact
                      you={player.id === user?.uid}
                      champion={player.id === championId}
                      onPress={() => router.push(`/(app)/player/${player.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const TAB_LABELS: Record<LeaderboardTab, string> = { table: "Table", stats: "Stats" };

// --- Stats boards -------------------------------------------------------------

/**
 * One side's AI-extracted stats off a match doc: the nested `{a,b}Stats` object wins,
 * otherwise the flat columns — mirroring how league/matches.ts reads them. Every value
 * stays null when the screenshot didn't capture it.
 */
function sideStats(data: Record<string, unknown>, side: "a" | "b") {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const nested = data[`${side}Stats`];
  if (nested && typeof nested === "object") {
    const stats = nested as Record<string, unknown>;
    return {
      possession: num(stats.possession),
      shots: num(stats.shots),
      shotsOnTarget: num(stats.shotsOnTarget ?? stats.shots_on_target),
      xg: num(stats.xg),
    };
  }
  return {
    possession: num(data[`${side}Possession`]),
    shots: num(data[`${side}Shots`]),
    shotsOnTarget: num(data[`${side}ShotsOnTarget`]),
    xg: num(data[`${side}Xg`]),
  };
}

function mapStatMatch(snapshot: QueryDocumentSnapshot): SeasonStatMatch {
  const data = snapshot.data();
  const a = sideStats(data, "a");
  const b = sideStats(data, "b");
  return {
    id: snapshot.id,
    aId: String(data.aId ?? ""),
    bId: String(data.bId ?? ""),
    aGoals: Number(data.aGoals ?? 0),
    bGoals: Number(data.bGoals ?? 0),
    finals: data.finals === true,
    // Streaks need true sequence — without this the streak helpers fall back to
    // trusting array order, which is document-id order and meaningless in time.
    date: data.date instanceof Timestamp ? data.date.toDate() : null,
    aPossession: a.possession,
    bPossession: b.possession,
    aShots: a.shots,
    bShots: b.shots,
    aShotsOnTarget: a.shotsOnTarget,
    bShotsOnTarget: b.shotsOnTarget,
    aXg: a.xg,
    bXg: b.xg,
  };
}

const playerName = (players: Map<string, LeaguePlayer>, uid: string) =>
  players.get(uid)?.name ?? "Unknown player";

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

/** One row of the streaks board. Exactly one of the two runs is presented — a player
 *  whose latest game was a win is "hot", otherwise they are "winless"; a player can
 *  never wear both labels (and never a zero-length one). */
interface StreakRow {
  playerId: string;
  /** Current consecutive wins — ≥2 to appear. */
  winStreak: number;
  /** Games since their last win — ≥2 to appear (their latest result wasn't a win). */
  winlessRun: number;
}

/** Current-form rows over every confirmed non-finals match in the season: live win
 *  streaks first (longest hottest), then the longest winless miseries. Best-ever runs
 *  are deliberately not shown here — on a form board a past peak reads as current and
 *  says nothing about present heat. */
function streakRows(matches: SeasonStatMatch[]): StreakRow[] {
  const uids = new Set<string>();
  for (const match of matches) {
    if (match.finals) continue;
    uids.add(match.aId);
    uids.add(match.bId);
  }
  const hot: StreakRow[] = [];
  const cold: StreakRow[] = [];
  for (const playerId of uids) {
    const winStreak = currentWinStreak(playerId, matches);
    if (winStreak >= 2) {
      hot.push({ playerId, winStreak, winlessRun: 0 });
      continue;
    }
    const winlessRun = currentWinlessRun(playerId, matches);
    if (winlessRun >= 2) cold.push({ playerId, winStreak: 0, winlessRun });
  }
  // Longest run first; ties break by uid for a stable board.
  const byLengthDesc = (a: StreakRow, b: StreakRow) =>
    b.winStreak - a.winStreak ||
    b.winlessRun - a.winlessRun ||
    a.playerId.localeCompare(b.playerId);
  return [...hot.sort(byLengthDesc), ...cold.sort(byLengthDesc)];
}

/** Lazy-loaded stats view: mounts only while the Stats segment is active, caches after that. */
function SeasonStatsBoard({
  seasonId,
  players,
}: {
  seasonId: string;
  players: Map<string, LeaguePlayer>;
}) {
  const { data, loading, error, reload } = useFocusData<{
    stats: SeasonLeaderboardStats;
    streaks: StreakRow[];
  }>(
    `leaderboard-stats:${seasonId || "active"}`,
    useCallback(async () => {
      if (!seasonId) return { stats: aggregateSeasonStats([]), streaks: [] };
      const snap = await getDocs(
        query(
          collection(db, "matches"),
          where("seasonId", "==", seasonId),
          where("status", "==", "confirmed"),
        ),
      );
      const matches = snap.docs.map(mapStatMatch);
      return { stats: aggregateSeasonStats(matches), streaks: streakRows(matches) };
    }, [seasonId]),
  );

  if (!data) {
    // Nothing cached yet: spinner on first load, but never a silent blank on a failed
    // first fetch — the failure card below must stay reachable (see changelogData PR note).
    if (loading) return <ActivityIndicator color={colors.accent} />;
    if (error)
      return (
        <Card style={{ borderColor: withAlpha(colors.loss, 0.35) }}>
          <Txt color={colors.loss} size={13}>
            Couldn't load the season stats. Check the connection and retry.
          </Txt>
          <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
            Retry
          </Button>
        </Card>
      );
    return null;
  }

  const stats = data.stats;
  const streaks = data.streaks;

  // Empty means the whole Stats view has nothing to say — including streaks, which
  // exist even for manual-only seasons where no screenshot stats were ever captured.
  const empty =
    stats.clinical.length === 0 &&
    stats.shotVolume.length === 0 &&
    stats.possession.length === 0 &&
    streaks.length === 0;

  return (
    <>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {error ? (
        <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
          <Txt color={colors.loss} size={13}>
            Couldn't load the season stats. Check the connection and retry.
          </Txt>
          <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
            Retry
          </Button>
        </Card>
      ) : null}
      {!error && !loading && empty ? (
        <Card style={{ alignItems: "center", paddingVertical: spacing.x3 }}>
          <Icon name="target" size={28} color={colors.textDim} />
          <Txt variant="head" size={17} style={{ marginTop: spacing.md }}>
            No stats captured yet
          </Txt>
          <Txt color={colors.textDim} style={{ marginTop: spacing.sm, textAlign: "center" }}>
            Log a match with a screenshot and the shot, possession and xG boards fill in here.
          </Txt>
        </Card>
      ) : null}
      {streaks.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            action={
              <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                right now
              </Txt>
            }
          >
            Streaks
          </SectionLabel>
          <View style={{ gap: spacing.sm }}>
            {streaks.map((row) => {
              // Rows are built as either hot (current win streak) or cold (winless run)
              // — never both, never a zero-length run.
              const hot = row.winStreak >= 2;
              return (
                <Card key={row.playerId} style={styles.row}>
                  <Icon
                    name={hot ? "flame" : "bolt"}
                    size={18}
                    color={hot ? colors.win : colors.loss}
                  />
                  <View style={styles.rowMain}>
                    <Txt variant="bodyMedium" size={14} numberOfLines={1}>
                      {playerName(players, row.playerId)}
                    </Txt>
                    <Txt size={11.5} color={colors.textDim}>
                      {hot
                        ? `${row.winStreak} win${row.winStreak === 1 ? "" : "s"} on the bounce`
                        : `no win in ${row.winlessRun} game${row.winlessRun === 1 ? "" : "s"}`}
                    </Txt>
                  </View>
                  <Txt variant="monoBold" size={16} color={hot ? colors.win : colors.loss}>
                    {hot ? `W${row.winStreak}` : `${row.winlessRun} winless`}
                  </Txt>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}
      {stats.clinical.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            action={
              <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                goals − xG
              </Txt>
            }
          >
            Clinical finishers
          </SectionLabel>
          <View style={{ gap: spacing.sm }}>
            {stats.clinical.map((row, index) => (
              <Card key={row.playerId} style={styles.row}>
                <Txt variant="monoBold" size={12} color={colors.textFaint} style={styles.rank}>
                  {index + 1}
                </Txt>
                <View style={styles.rowMain}>
                  <Txt variant="bodyMedium" size={14} numberOfLines={1}>
                    {playerName(players, row.playerId)}
                  </Txt>
                  <Txt size={11.5} color={colors.textDim}>
                    {row.games} game{row.games === 1 ? "" : "s"} with xG · {row.goals} goal
                    {row.goals === 1 ? "" : "s"} · {fmtXg(row.xg)} xG
                  </Txt>
                </View>
                <Txt variant="monoBold" size={16} color={row.delta >= 0 ? colors.win : colors.loss}>
                  {signed(row.delta)}
                </Txt>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
      {stats.shotVolume.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            action={
              <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                on target %
              </Txt>
            }
          >
            Shot volume
          </SectionLabel>
          <View style={{ gap: spacing.sm }}>
            {stats.shotVolume.map((row, index) => (
              <Card key={row.playerId} style={styles.row}>
                <Txt variant="monoBold" size={12} color={colors.textFaint} style={styles.rank}>
                  {index + 1}
                </Txt>
                <View style={styles.rowMain}>
                  <Txt variant="bodyMedium" size={14} numberOfLines={1}>
                    {playerName(players, row.playerId)}
                  </Txt>
                  <Txt size={11.5} color={colors.textDim}>
                    {row.shots} shots in {row.games} game{row.games === 1 ? "" : "s"} ·{" "}
                    {row.shotsOnTarget} on target
                  </Txt>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${row.accuracyPct ?? 0}%` }]} />
                  </View>
                </View>
                <Txt variant="monoBold" size={15} color={colors.accent}>
                  {row.accuracyPct == null ? "—" : `${row.accuracyPct}%`}
                </Txt>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
      {stats.playersWithoutXg.length > 0 ? (
        <Txt size={11.5} color={colors.textFaint} style={styles.sectionNote}>
          No xG data yet: {stats.playersWithoutXg.map((uid) => playerName(players, uid)).join(", ")}
        </Txt>
      ) : null}
      {stats.possession.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel
            action={
              <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                avg %
              </Txt>
            }
          >
            Possession kings
          </SectionLabel>
          <View style={{ gap: spacing.sm }}>
            {stats.possession.map((row, index) => (
              <Card key={row.playerId} style={styles.row}>
                <Txt variant="monoBold" size={12} color={colors.textFaint} style={styles.rank}>
                  {index + 1}
                </Txt>
                <View style={styles.rowMain}>
                  <Txt variant="bodyMedium" size={14} numberOfLines={1}>
                    {playerName(players, row.playerId)}
                  </Txt>
                  <Txt size={11.5} color={colors.textDim}>
                    across {row.games} game{row.games === 1 ? "" : "s"}
                  </Txt>
                  <View style={styles.barTrack}>
                    <View
                      style={[styles.barFill, { width: `${Math.min(row.averagePct, 100)}%` }]}
                    />
                  </View>
                </View>
                <Txt variant="monoBold" size={15} color={colors.accent}>
                  {row.averagePct}%
                </Txt>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
      {!empty && !error ? (
        <Card style={styles.captionCard}>
          <Txt size={12} color={colors.textDim}>
            These numbers come from AI-extracted match screenshots and are optional, so coverage
            varies between players and games.
          </Txt>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  seasonScroll: { gap: spacing.sm, paddingBottom: spacing.md },
  seasonChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  seasonChipActive: { borderColor: colors.accent },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  tabSwitch: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  tabOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabOptionActive: { backgroundColor: colors.accent },
  finalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  search: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: colors.text,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
  },
  section: { marginBottom: spacing.x2 },
  sectionNote: { marginTop: spacing.sm, marginHorizontal: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  rank: { width: 16, textAlign: "center" },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface2,
    marginTop: 4,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 2, backgroundColor: colors.accent },
  captionCard: { marginTop: spacing.sm },
});
