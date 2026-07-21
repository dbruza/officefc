import { useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AchievementBadge,
  Avatar,
  Button,
  Card,
  FormChips,
  Icon,
  LineChart,
  ScreenHeader,
  SeasonMatchRow,
  SectionLabel,
  StatCard,
  Txt,
  type ChartPoint,
} from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getEloHistory,
  getHeadToHeadsForPlayer,
  getLeaguePlayers,
  getPlayerMatches,
  getPlayerStats,
  getSeasonResults,
  getSeasons,
  getStandings,
  type HeadToHead,
  type LeagueMatch,
  type LeaguePlayer,
  type PlayerStats,
  type Season,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { computeAchievements } from "@/lib/awards";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

const RECENT_PREVIEW = 6;

interface ProfileData {
  player: LeaguePlayer | null;
  players: Map<string, LeaguePlayer>;
  season: Season | null;
  seasons: Season[];
  seasonResults: SeasonResult[];
  standing: Standing | null;
  stats: PlayerStats | null;
  matches: LeagueMatch[];
  history: ChartPoint[];
  headToHeads: HeadToHead[];
}

export function PlayerProfileScreen({ uid, root = false }: { uid: string; root?: boolean }) {
  const router = useRouter();
  const { user, signOutUser } = useAuth();

  const {
    data,
    loading,
    error: loadFailed,
    reload,
  } = useFocusData<ProfileData>(
    `player:${uid}`,
    useCallback(async () => {
      const [seasonRows, roster, allTime, pairs, playedMatches, results] = await Promise.all([
        getSeasons(),
        getLeaguePlayers(),
        getPlayerStats(uid),
        getHeadToHeadsForPlayer(uid),
        getPlayerMatches(uid),
        getSeasonResults(),
      ]);
      const activeSeason = seasonRows.find((item) => item.active) ?? null;
      const [table, eloPoints] = activeSeason
        ? await Promise.all([getStandings(activeSeason.id), getEloHistory(activeSeason.id, uid)])
        : [[], []];
      return {
        player: roster.find((item) => item.id === uid) ?? null,
        players: new Map(roster.map((item) => [item.id, item])),
        season: activeSeason,
        seasons: seasonRows,
        seasonResults: results,
        standing: table.find((item) => item.uid === uid) ?? null,
        stats: allTime,
        matches: playedMatches,
        history: eloPoints.map((point) => ({
          date: point.date.toISOString().slice(0, 10),
          rating: point.rating,
        })),
        headToHeads: pairs,
      };
    }, [uid]),
  );
  const player = data?.player ?? null;
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const season = data?.season ?? null;
  const seasons = data?.seasons ?? [];
  const seasonResults = data?.seasonResults ?? [];
  const standing = data?.standing ?? null;
  const stats = data?.stats ?? null;
  const matches = data?.matches ?? [];
  const history = data?.history ?? [];
  const headToHeads = data?.headToHeads ?? [];
  const error = loadFailed ? "Couldn't load this profile. Check the connection and retry." : null;

  const isYou = uid === user?.uid;
  const form = standing?.form ?? [];
  const isReigningChampion = seasonResults.length > 0 && uid === seasonResults[0].championId;
  const seasonsById = new Map(seasons.map((item) => [item.id, item]));
  // Honours: Champion (table-topper historically; Grand Final winner for finals-format
  // seasons), Premier (finals-format table-topper), or The Double for both in one season.
  const titles = seasonResults.flatMap((result) => {
    const champion = result.championId === uid;
    const premier = result.format === "finals" && result.premierId === uid;
    const kind =
      champion && premier ? "double" : champion ? "champion" : premier ? "premier" : null;
    return kind ? [{ seasonId: result.seasonId, kind }] : [];
  });
  const achievements = computeAchievements(uid, stats, matches);
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
  const recentMatches = matches.slice().reverse();
  const previewMatches = recentMatches.slice(0, RECENT_PREVIEW);
  const h2hRows = headToHeads
    .map((pair) => {
      const asA = pair.aId === uid;
      return {
        pair,
        opponentId: asA ? pair.bId : pair.aId,
        wins: asA ? pair.aWins : pair.bWins,
        losses: asA ? pair.bWins : pair.aWins,
        draws: pair.draws,
      };
    })
    .sort((a, b) => b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws));

  return (
    <SafeAreaView style={styles.safe} edges={root ? ["top"] : ["top", "bottom"]}>
      <ScreenHeader
        title={isYou ? "Your profile" : (player?.name ?? "Player profile")}
        subtitle={player ? `@${player.handle} · #${player.jersey}` : undefined}
        back={!root}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card>
            <Txt color={colors.loss}>{error}</Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!loading && player ? (
          <>
            <View style={styles.hero}>
              <Avatar player={player} size={66} ring jersey champion={isReigningChampion} />
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  CURRENT ELO
                </Txt>
                <Txt variant="monoBold" size={44} color={colors.accent} style={styles.elo}>
                  {standing?.elo ?? 1500}
                </Txt>
                <Txt variant="mono" size={12} color={colors.textDim}>
                  {standing?.ranked
                    ? `Rank #${standing.rank}`
                    : standing
                      ? "Placement"
                      : "Unranked"}{" "}
                  · {season?.name ?? "No active season"}
                </Txt>
              </View>
            </View>

            <Card style={styles.chartCard}>
              <View style={styles.cardHeading}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  ELO OVER TIME
                </Txt>
                <Txt variant="mono" size={11} color={colors.textDim}>
                  {Math.max(0, history.length - 1)} games
                </Txt>
              </View>
              {history.length >= 2 ? (
                <LineChart data={history} />
              ) : (
                <View style={styles.chartEmpty}>
                  <Icon name="board" size={22} color={colors.textFaint} />
                  <Txt size={12} color={colors.textDim}>
                    Confirmed matches will draw the rating line.
                  </Txt>
                </View>
              )}
            </Card>

            <View style={styles.statGrid}>
              <View style={styles.statCell}>
                <StatCard
                  label="Record"
                  value={`${stats?.w ?? 0}-${stats?.d ?? 0}-${stats?.l ?? 0}`}
                  sub={`${stats?.games ?? 0} games`}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label="Win rate"
                  value={`${stats?.winRate ?? 0}%`}
                  sub={`${stats?.gf ?? 0} for · ${stats?.ga ?? 0} against`}
                  accent
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label="Current"
                  value={stats?.currentStreak ?? 0}
                  sub={streakLabel(stats)}
                  accent={stats?.currentStreakType === "W"}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label="Best streak"
                  value={stats?.longestWin ?? 0}
                  sub={`${stats?.longestUnbeaten ?? 0} unbeaten`}
                />
              </View>
            </View>

            <View style={styles.splitCards}>
              <Card style={styles.splitCard}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  LAST 5
                </Txt>
                <View style={{ marginTop: spacing.sm }}>
                  <FormChips results={form} size={23} />
                </View>
              </Card>
              <Card style={styles.splitCard}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  BIGGEST WIN
                </Txt>
                {stats?.biggestWin ? (
                  <>
                    <Txt variant="monoBold" size={22} style={{ marginTop: 5 }}>
                      {stats.biggestWin.goalsFor}:{stats.biggestWin.goalsAgainst}
                    </Txt>
                    <Txt size={11} color={colors.textDim} numberOfLines={1}>
                      vs {players.get(stats.biggestWin.opponentId)?.name ?? "Opponent"}
                    </Txt>
                  </>
                ) : (
                  <Txt size={12} color={colors.textFaint} style={{ marginTop: spacing.sm }}>
                    No wins yet
                  </Txt>
                )}
              </Card>
            </View>

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel
                action={
                  matches.length > RECENT_PREVIEW ? (
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: "/(app)/games", params: { uid } } as Href)
                      }
                    >
                      <Txt variant="head" size={11} color={colors.accent}>
                        SEE ALL
                      </Txt>
                    </Pressable>
                  ) : matches.length ? (
                    <Txt variant="monoBold" size={11} color={colors.textDim}>
                      {matches.length} played
                    </Txt>
                  ) : undefined
                }
              >
                Recent games
              </SectionLabel>
              <View style={{ gap: 7 }}>
                {previewMatches.map((match) => {
                  const playerA = players.get(match.aId);
                  const playerB = players.get(match.bId);
                  if (!playerA || !playerB) return null;
                  return (
                    <SeasonMatchRow
                      key={match.id}
                      match={match}
                      playerA={playerA}
                      playerB={playerB}
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/match/[id]",
                          params: { id: match.id },
                        } as Href)
                      }
                    />
                  );
                })}
                {matches.length === 0 ? (
                  <Card style={{ alignItems: "center" }}>
                    <Txt color={colors.textDim}>No confirmed games yet.</Txt>
                  </Card>
                ) : null}
              </View>
            </View>

            {titles.length > 0 ? (
              <View style={{ marginTop: spacing.x2 }}>
                <SectionLabel
                  action={
                    <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                      {titles.length} {titles.length === 1 ? "title" : "titles"}
                    </Txt>
                  }
                >
                  Silverware
                </SectionLabel>
                <View style={{ gap: spacing.sm }}>
                  {titles.map((title) => {
                    const titleSeason = seasonsById.get(title.seasonId);
                    const label =
                      title.kind === "double"
                        ? "The Double"
                        : title.kind === "premier"
                          ? "Premier"
                          : "Champion";
                    const sub =
                      title.kind === "double"
                        ? "Premier + Champion"
                        : title.kind === "premier"
                          ? "Top of the table"
                          : "League title";
                    return (
                      <View key={`${title.seasonId}-${title.kind}`} style={styles.titleRow}>
                        <View style={styles.trophyTile}>
                          <Icon
                            name={
                              title.kind === "double"
                                ? "crown"
                                : title.kind === "premier"
                                  ? "medal"
                                  : "trophy"
                            }
                            size={18}
                            color={colors.gold}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                            {titleSeason?.name ?? "Season"} {label}
                          </Txt>
                          <Txt variant="mono" size={10.5} color={colors.textDim}>
                            {titleSeason ? `${titleSeason.year} · ` : ""}
                            {sub}
                          </Txt>
                        </View>
                        {isReigningChampion &&
                        title.kind !== "premier" &&
                        title.seasonId === seasonResults[0]?.seasonId ? (
                          <View style={styles.reigning}>
                            <Txt variant="monoBold" size={8} color={colors.gold}>
                              REIGNING
                            </Txt>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel
                action={
                  <Txt variant="monoBold" size={11.5} color={colors.textDim}>
                    {unlockedCount}/{achievements.length} unlocked
                  </Txt>
                }
              >
                Achievements
              </SectionLabel>
              <View style={styles.achievementGrid}>
                {achievements.map((achievement) => (
                  <View key={achievement.key} style={styles.achievementCell}>
                    <AchievementBadge achievement={achievement} />
                  </View>
                ))}
              </View>
            </View>

            <View style={{ marginTop: spacing.x2 }}>
              <SectionLabel>Head-to-head record</SectionLabel>
              <View style={{ gap: spacing.sm }}>
                {h2hRows.map((row) => {
                  const opponent = players.get(row.opponentId);
                  if (!opponent) return null;
                  const games = row.wins + row.draws + row.losses;
                  return (
                    <Pressable
                      key={row.pair.pairKey}
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/h2h",
                          params: { a: uid, b: opponent.id },
                        } as Href)
                      }
                      style={styles.h2hRow}
                    >
                      <Avatar player={opponent} size={36} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                          {opponent.name}
                        </Txt>
                        <Txt variant="mono" size={10.5} color={colors.textDim}>
                          {games} meetings
                        </Txt>
                      </View>
                      {row.losses > row.wins && games >= 3 ? (
                        <View style={styles.nemesis}>
                          <Txt variant="monoBold" size={8} color={colors.loss}>
                            NEMESIS
                          </Txt>
                        </View>
                      ) : null}
                      <Txt variant="monoBold" size={18}>
                        <Txt
                          variant="monoBold"
                          size={18}
                          color={
                            row.wins > row.losses
                              ? colors.win
                              : row.wins < row.losses
                                ? colors.loss
                                : colors.text
                          }
                        >
                          {row.wins}
                        </Txt>
                        <Txt variant="monoBold" size={18} color={colors.textFaint}>
                          {" – "}
                        </Txt>
                        {row.losses}
                      </Txt>
                      <Icon name="chevron" size={15} color={colors.textFaint} />
                    </Pressable>
                  );
                })}
                {h2hRows.length === 0 ? (
                  <Card style={{ alignItems: "center" }}>
                    <Txt color={colors.textDim}>No confirmed matchups yet.</Txt>
                  </Card>
                ) : null}
              </View>
            </View>

            {isYou && root ? (
              <Button full variant="ghost" style={{ marginTop: spacing.x2 }} onPress={signOutUser}>
                Sign out
              </Button>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function streakLabel(stats: PlayerStats | null): string {
  if (!stats?.currentStreakType) return "no active run";
  if (stats.currentStreakType === "W") return "win streak";
  if (stats.currentStreakType === "L") return "losses in a row";
  return "drawn run";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.x3,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: 2,
    paddingVertical: spacing.lg,
  },
  kicker: { letterSpacing: 1.2 },
  elo: { lineHeight: 46, letterSpacing: -1.2, marginTop: 2 },
  chartCard: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 8 },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  chartEmpty: {
    height: 130,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statCell: { width: "48.7%" },
  splitCards: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  splitCard: { flex: 1, minHeight: 102 },
  achievementGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  achievementCell: { width: "48.7%" },
  h2hRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  nemesis: {
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.35),
    backgroundColor: withAlpha(colors.loss, 0.08),
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  trophyTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.35),
    backgroundColor: withAlpha(colors.gold, 0.1),
  },
  reigning: {
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.35),
    backgroundColor: withAlpha(colors.gold, 0.08),
  },
});
