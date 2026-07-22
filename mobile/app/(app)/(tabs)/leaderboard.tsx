import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Card, Icon, PlayerRow, ScreenHeader, SectionLabel, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getLeaguePlayers,
  getSeasonResults,
  getSeasons,
  getStandings,
  type LeaguePlayer,
  type Season,
  type Standing,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { colors, spacing } from "@/theme";

interface LeaderboardData {
  seasons: Season[];
  selectedId: string;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  championId: string | null;
}

export default function Leaderboard() {
  const router = useRouter();
  const { user } = useAuth();
  // "" means "whatever season is active" until the user explicitly picks one.
  const [seasonId, setSeasonId] = useState("");
  const [queryText, setQueryText] = useState("");

  const { data, loading } = useFocusData<LeaderboardData>(
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
        {!loading &&
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
      </ScrollView>
    </SafeAreaView>
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
});
