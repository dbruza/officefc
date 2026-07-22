import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ActivityFeed,
  Avatar,
  Button,
  Card,
  Icon,
  PlayerRow,
  SectionLabel,
  Txt,
} from "@/components";
import { AdminInvite } from "@/components/AdminInvite";
import { useAuth } from "@/lib/auth";
import {
  ensureLeagueSetup,
  getActiveSeason,
  getLeaguePlayers,
  getPlayerStats,
  getRecentActivity,
  getStandings,
  rebuildLeagueReadModels,
  type ActivityEvent,
  type LeaguePlayer,
  type PlayerStats,
  type Season,
  type Standing,
} from "@/lib/league";
import { usePendingConfirmations } from "@/lib/usePendingConfirmations";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { initialsOf, type Player } from "@/types";
import { colors, spacing, radius } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

interface HomeData {
  season: Season | null;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  playerStats: PlayerStats | null;
  activity: ActivityEvent[];
}

export default function Home() {
  const router = useRouter();
  const { user, profile, membership } = useAuth();
  const isAdmin = membership?.role === "admin";
  const uid = user?.uid;
  const [inboxError, setInboxError] = useState<string | null>(null);
  const { matches: pendingMatches } = usePendingConfirmations(uid, {
    onError: () => setInboxError("Couldn't update the confirmation inbox in real time."),
  });
  const pendingCount = pendingMatches.length;

  const {
    data,
    loading,
    error: loadFailed,
    reload,
  } = useFocusData<HomeData>(
    `home:${uid ?? "anon"}`,
    useCallback(async () => {
      if (!uid) {
        return {
          season: null,
          standings: [],
          players: new Map<string, LeaguePlayer>(),
          playerStats: null,
          activity: [],
        };
      }
      if (isAdmin) {
        await ensureLeagueSetup();
      }
      const activeSeason = await getActiveSeason();
      const [roster, table, allTime, feed] = await Promise.all([
        getLeaguePlayers(),
        activeSeason ? getStandings(activeSeason.id) : Promise.resolve([]),
        getPlayerStats(uid),
        getRecentActivity(20),
      ]);
      let resolvedStats = allTime;
      if (!resolvedStats && isAdmin && table.length) {
        await rebuildLeagueReadModels();
        resolvedStats = await getPlayerStats(uid);
      }
      return {
        season: activeSeason,
        standings: table,
        players: new Map(roster.map((player) => [player.id, player])),
        playerStats: resolvedStats,
        activity: feed,
      };
    }, [isAdmin, uid]),
  );
  const season = data?.season ?? null;
  const standings = data?.standings ?? [];
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const playerStats = data?.playerStats ?? null;
  const activity = data?.activity ?? [];
  const error = loadFailed
    ? "Couldn't load the live league data. Check the connection and retry."
    : inboxError;

  const scrollRef = useRef<ScrollView>(null);
  useTabRetap("home", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const me: Player | null = profile
    ? {
        id: user?.uid ?? "me",
        name: profile.displayName,
        handle: profile.handle,
        jersey: profile.jersey,
        color: profile.color,
        initials: initialsOf(profile.displayName),
        isYou: true,
      }
    : null;
  const myStanding = standings.find((row) => row.uid === user?.uid);
  const nemesis = playerStats?.nemesis ? players.get(playerStats.nemesis.opponentId) : null;
  const daysLeft = useMemo(() => {
    if (!season) return 0;
    return Math.max(0, Math.ceil((season.end.getTime() - Date.now()) / 86_400_000));
  }, [season]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={{ letterSpacing: 1.6 }}>
              OFFICEFC · {season?.name.toUpperCase() ?? "LEAGUE"}
            </Txt>
            <Txt variant="head" size={24} numberOfLines={1} style={{ marginTop: 2 }}>
              Hey, {profile?.displayName?.split(" ")[0] ?? "player"}
            </Txt>
          </View>
          {me ? <Avatar player={me} size={44} ring jersey /> : null}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.x2 }} />
        ) : null}

        {!loading ? (
          <Card style={styles.hero} padded onPress={() => router.navigate("/(app)/(tabs)/profile")}>
            <View style={styles.heroTop}>
              <View>
                <Txt
                  variant="head"
                  size={10.5}
                  color={colors.textDim}
                  style={{ letterSpacing: 1.4 }}
                >
                  YOUR SEASON
                </Txt>
                <Txt variant="monoBold" size={40} color={colors.accent} style={{ marginTop: 4 }}>
                  {myStanding?.elo ?? 1500}
                </Txt>
                <Txt variant="mono" size={11.5} color={colors.textDim}>
                  ELO ·{" "}
                  {myStanding?.ranked
                    ? `RANK #${myStanding.rank}`
                    : myStanding
                      ? "PLACEMENT"
                      : "UNRANKED"}
                </Txt>
              </View>
              <View style={styles.seasonMeta}>
                <Txt variant="monoBold" size={18}>
                  {daysLeft}
                </Txt>
                <Txt size={10.5} color={colors.textDim}>
                  DAYS LEFT
                </Txt>
              </View>
            </View>
            <View style={styles.recordRow}>
              <Record value={myStanding?.w ?? 0} label="W" color={colors.win} />
              <Record value={myStanding?.d ?? 0} label="D" color={colors.draw} />
              <Record value={myStanding?.l ?? 0} label="L" color={colors.loss} />
              <View style={{ flex: 1 }} />
              {playerStats?.currentStreakType ? (
                <Txt
                  variant="monoBold"
                  size={9.5}
                  color={playerStats.currentStreakType === "W" ? colors.accent : colors.textDim}
                >
                  {playerStats.currentStreak} {streakCopy(playerStats.currentStreakType)}
                </Txt>
              ) : null}
              <Pressable
                disabled={!isAdmin}
                onPress={() => router.push("/(app)/admin")}
                hitSlop={8}
                accessibilityRole={isAdmin ? "button" : undefined}
                style={[styles.roleChip, isAdmin && { backgroundColor: colors.accent }]}
              >
                <Txt
                  variant="monoBold"
                  size={9}
                  color={isAdmin ? colors.onAccent : colors.textDim}
                  style={{ letterSpacing: 1 }}
                >
                  {(membership?.role ?? "member").toUpperCase()}
                </Txt>
                {isAdmin ? <Icon name="chevron" size={10} color={colors.onAccent} /> : null}
              </Pressable>
            </View>
          </Card>
        ) : null}

        {season?.phase === "finals" ? (
          <Pressable
            onPress={() => router.push("/(app)/finals")}
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

        <View style={styles.primaryActions}>
          <View style={{ flex: 1 }}>
            <Button full size="lg" icon="plus" onPress={() => router.push("/(app)/log-match")}>
              Log match
            </Button>
          </View>
          <Pressable onPress={() => router.push("/(app)/confirmations")} style={styles.inboxButton}>
            <Icon name="check" size={20} color={pendingCount ? colors.accent : colors.textDim} />
            {pendingCount ? (
              <View style={styles.badge}>
                <Txt variant="monoBold" size={9} color={colors.onAccent}>
                  {pendingCount}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </View>

        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              {error}
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {nemesis &&
        playerStats?.nemesis &&
        playerStats.nemesis.losses > playerStats.nemesis.wins ? (
          <View style={{ marginBottom: spacing.x2 }}>
            <SectionLabel>Current nemesis</SectionLabel>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(app)/h2h",
                  params: { a: user?.uid ?? "", b: nemesis.id },
                })
              }
              style={styles.nemesisCard}
            >
              <Avatar player={nemesis} size={48} jersey />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyMedium" size={14.5} numberOfLines={1}>
                  {nemesis.name}
                </Txt>
                <Txt size={11.5} color={colors.textDim}>
                  your worst matchup
                </Txt>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Txt variant="monoBold" size={24}>
                  <Txt variant="monoBold" size={24} color={colors.loss}>
                    {playerStats.nemesis.wins}
                  </Txt>
                  <Txt variant="monoBold" size={22} color={colors.textFaint}>
                    {" – "}
                  </Txt>
                  {playerStats.nemesis.losses}
                </Txt>
                <Txt variant="head" size={8.5} color={colors.loss} style={{ letterSpacing: 1 }}>
                  ALL-TIME
                </Txt>
              </View>
            </Pressable>
          </View>
        ) : null}

        <SectionLabel
          action={
            <Pressable onPress={() => router.navigate("/(app)/(tabs)/leaderboard")}>
              <Txt variant="head" size={11} color={colors.accent}>
                FULL TABLE
              </Txt>
            </Pressable>
          }
        >
          Top of the table
        </SectionLabel>
        {standings.some((s) => s.ranked) ? (
          <View style={{ gap: spacing.sm }}>
            {standings
              .filter((s) => s.ranked)
              .slice(0, 3)
              .map((standing) => {
                const player = players.get(standing.uid);
                if (!player) return null;
                return (
                  <PlayerRow
                    key={standing.uid}
                    player={player}
                    rank={standing.rank}
                    elo={standing.elo}
                    form={standing.form}
                    move={standing.move}
                    you={standing.uid === user?.uid}
                    onPress={() => router.push(`/(app)/player/${standing.uid}`)}
                  />
                );
              })}
          </View>
        ) : (
          <Card style={styles.emptyTable}>
            <Icon name="board" size={24} color={colors.textDim} />
            <View style={{ flex: 1 }}>
              <Txt variant="head" size={14}>
                No confirmed results yet
              </Txt>
              <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }}>
                Log a match, get the opponent's nod, and the table comes alive.
              </Txt>
            </View>
          </Card>
        )}

        {!loading ? (
          <View style={{ marginTop: spacing.x2 }}>
            <SectionLabel>League activity</SectionLabel>
            <ActivityFeed
              events={activity}
              players={players}
              onOpenMatch={(matchId) => router.push(`/(app)/match/${matchId}`)}
              onOpenPlayer={(uid) => router.push(`/(app)/player/${uid}`)}
            />
          </View>
        ) : null}

        {isAdmin ? <AdminInvite /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function streakCopy(result: "W" | "D" | "L"): string {
  if (result === "W") return "WIN STREAK";
  if (result === "L") return "LOSS RUN";
  return "DRAWN";
}

function Record({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
      <Txt variant="monoBold" size={16}>
        {value}
      </Txt>
      <Txt variant="head" size={9.5} color={color}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  hero: {
    backgroundColor: mix(colors.surface, colors.accent, 6),
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
    marginBottom: spacing.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  seasonMeta: {
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  finalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  primaryActions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
    marginBottom: spacing.x2,
  },
  inboxButton: {
    width: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 7,
    right: 7,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTable: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.x2,
  },
  nemesisCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.2),
    borderRadius: radius.lg,
    backgroundColor: mix(colors.surface, colors.loss, 5),
  },
});
