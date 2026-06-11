import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AchievementBadge,
  AppTabBar,
  Avatar,
  Button,
  Card,
  FormChips,
  Icon,
  LineChart,
  ScreenHeader,
  SectionLabel,
  StatCard,
  Txt,
  type ChartPoint,
} from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getActiveSeason,
  getEloHistory,
  getHeadToHeadsForPlayer,
  getLeaguePlayers,
  getPlayerMatches,
  getPlayerStats,
  getStandings,
  type HeadToHead,
  type LeagueMatch,
  type LeaguePlayer,
  type PlayerStats,
  type Season,
  type Standing,
} from "@/lib/league";
import { computeAchievements } from "@/lib/awards";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

export function PlayerProfileScreen({ uid, root = false }: { uid: string; root?: boolean }) {
  const router = useRouter();
  const { user, signOutUser } = useAuth();
  const [player, setPlayer] = useState<LeaguePlayer | null>(null);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [season, setSeason] = useState<Season | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [headToHeads, setHeadToHeads] = useState<HeadToHead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeSeason, roster, allTime, pairs, playedMatches] = await Promise.all([
        getActiveSeason(),
        getLeaguePlayers(),
        getPlayerStats(uid),
        getHeadToHeadsForPlayer(uid),
        getPlayerMatches(uid),
      ]);
      const [table, eloPoints] = activeSeason
        ? await Promise.all([getStandings(activeSeason.id), getEloHistory(activeSeason.id, uid)])
        : [[], []];
      setSeason(activeSeason);
      setPlayer(roster.find((item) => item.id === uid) ?? null);
      setPlayers(new Map(roster.map((item) => [item.id, item])));
      setStats(allTime);
      setMatches(playedMatches);
      setHeadToHeads(pairs);
      setStanding(table.find((item) => item.uid === uid) ?? null);
      setHistory(
        eloPoints.map((point) => ({
          date: point.date.toISOString().slice(0, 10),
          rating: point.rating,
        })),
      );
    } catch {
      setError("Couldn't load this profile. Check the connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isYou = uid === user?.uid;
  const form = standing?.form ?? [];
  const achievements = computeAchievements(uid, stats, matches);
  const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={load}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!loading && player ? (
          <>
            <View style={styles.hero}>
              <Avatar player={player} size={66} ring jersey />
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  CURRENT ELO
                </Txt>
                <Txt variant="monoBold" size={44} color={colors.accent} style={styles.elo}>
                  {standing?.elo ?? 1500}
                </Txt>
                <Txt variant="mono" size={12} color={colors.textDim}>
                  {standing ? `Rank #${standing.rank}` : "Unranked"} ·{" "}
                  {season?.name ?? "No active season"}
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
      {root ? <AppTabBar active="profile" /> : null}
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
});
