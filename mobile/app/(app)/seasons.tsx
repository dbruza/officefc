import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AppTabBar,
  Avatar,
  Card,
  Icon,
  ScreenHeader,
  SectionLabel,
  Txt,
} from "@/components";
import {
  getLeaguePlayers,
  getSeasonPotm,
  getSeasonResult,
  getSeasons,
  getStandings,
  type LeaguePlayer,
  type PotmResult,
  type Season,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

interface PastSeason {
  season: Season;
  result: SeasonResult | null;
  potm: PotmResult[];
}

export default function SeasonsRoute() {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [leader, setLeader] = useState<Standing | null>(null);
  const [past, setPast] = useState<PastSeason[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([getSeasons(), getLeaguePlayers()])
        .then(async ([seasonRows, roster]) => {
          const active = seasonRows.find((season) => season.active) ?? null;
          const old = seasonRows.filter((season) => !season.active);
          const [table, archives] = await Promise.all([
            active ? getStandings(active.id) : Promise.resolve([]),
            Promise.all(
              old.map(async (season) => ({
                season,
                result: await getSeasonResult(season.id),
                potm: await getSeasonPotm(season.id),
              })),
            ),
          ]);
          setSeasons(seasonRows);
          setPlayers(new Map(roster.map((player) => [player.id, player])));
          setLeader(table[0] ?? null);
          setPast(archives);
        })
        .finally(() => setLoading(false));
    }, []),
  );

  const active = seasons.find((season) => season.active) ?? null;
  const daysLeft = active ? Math.max(0, Math.ceil((active.end.getTime() - Date.now()) / 86_400_000)) : 0;
  const totalDays = active ? Math.max(1, (active.end.getTime() - active.start.getTime()) / 86_400_000) : 1;
  const elapsedDays = active ? Math.max(0, (Date.now() - active.start.getTime()) / 86_400_000) : 0;
  const progress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  const leadingPlayer = leader ? players.get(leader.uid) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Seasons" subtitle="Hall of Fame & silverware" back={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {active ? (
          <Card style={styles.current}>
            <View style={styles.currentTop}>
              <View style={{ flex: 1 }}>
                <Txt variant="head" size={10} color={colors.accent} style={styles.kicker}>
                  ● LIVE SEASON
                </Txt>
                <Txt variant="head" size={25} style={{ marginTop: 3 }}>
                  {active.name}
                </Txt>
                <Txt size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
                  {formatRange(active)} · {active.year}
                </Txt>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Txt variant="monoBold" size={32} color={colors.accent}>
                  {daysLeft}
                </Txt>
                <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                  DAYS LEFT
                </Txt>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.leading}>
              {leadingPlayer ? (
                <>
                  <Avatar player={leadingPlayer} size={32} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                      LEADING
                    </Txt>
                    <Txt variant="bodyMedium" size={13}>
                      {leadingPlayer.name}
                    </Txt>
                  </View>
                </>
              ) : (
                <Txt size={12} color={colors.textDim} style={{ flex: 1 }}>
                  The first confirmed result starts the race.
                </Txt>
              )}
              <Icon name="trophy" size={26} color={colors.accent} />
            </View>
          </Card>
        ) : null}

        <SectionLabel>Past seasons</SectionLabel>
        <View style={{ gap: spacing.md }}>
          {past.map(({ season, result, potm }) => (
            <Pressable
              key={season.id}
              onPress={() =>
                router.push({
                  pathname: "/(app)/archive/[id]",
                  params: { id: season.id },
                } as Href)
              }
              style={styles.pastCard}
            >
              <View style={styles.pastHeading}>
                <View>
                  <Txt variant="head" size={16}>
                    {season.name}
                  </Txt>
                  <Txt size={11.5} color={colors.textDim}>
                    {season.year}
                  </Txt>
                </View>
                <Icon name="chevron" size={17} color={colors.textDim} />
              </View>
              {result ? (
                <View style={styles.podiumRow}>
                  <Podium
                    label="Champion"
                    player={players.get(result.championId)}
                    icon="trophy"
                    color="#ffd24a"
                  />
                  <Podium
                    label="Runner-up"
                    player={players.get(result.runnerUpId)}
                    icon="medal"
                    color="#cdd6e0"
                  />
                </View>
              ) : (
                <Txt size={12} color={colors.textDim}>
                  Final result pending.
                </Txt>
              )}
              {potm.length ? (
                <View style={styles.potmRow}>
                  <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
                    POTM
                  </Txt>
                  {potm.map((item) => {
                    const player = players.get(item.playerId);
                    return player ? (
                      <View key={item.month} style={styles.potm}>
                        <Avatar player={player} size={20} />
                        <Txt variant="mono" size={10.5} color={colors.textDim}>
                          {item.month}
                        </Txt>
                      </View>
                    ) : null;
                  })}
                </View>
              ) : null}
            </Pressable>
          ))}
          {!loading && past.length === 0 ? (
            <Card style={{ alignItems: "center", paddingVertical: spacing.x2 }}>
              <Icon name="crown" size={26} color={colors.textFaint} />
              <Txt variant="head" size={15} style={{ marginTop: spacing.sm }}>
                History starts here
              </Txt>
              <Txt size={12} color={colors.textDim} style={{ marginTop: 4, textAlign: "center" }}>
                Finished seasons will appear in the Hall of Fame.
              </Txt>
            </Card>
          ) : null}
        </View>
      </ScrollView>
      <AppTabBar active="seasons" />
    </SafeAreaView>
  );
}

function Podium({
  label,
  player,
  icon,
  color,
}: {
  label: string;
  player: LeaguePlayer | undefined;
  icon: "trophy" | "medal";
  color: string;
}) {
  if (!player) return null;
  return (
    <View style={styles.podium}>
      <Avatar player={player} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name={icon} size={12} color={color} />
          <Txt variant="head" size={8.5} color={colors.textDim} style={styles.kicker}>
            {label.toUpperCase()}
          </Txt>
        </View>
        <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
          {player.name}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  current: {
    marginBottom: spacing.x2,
    borderRadius: radius.xl,
    borderColor: withAlpha(colors.accent, 0.22),
    backgroundColor: mix(colors.surface, colors.accent, 6),
  },
  currentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { letterSpacing: 1.1 },
  progressTrack: {
    height: 7,
    marginTop: spacing.x2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  pastCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pastHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  podiumRow: { flexDirection: "row", gap: spacing.sm },
  podium: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  potmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  potm: { flexDirection: "row", alignItems: "center", gap: 4 },
});
