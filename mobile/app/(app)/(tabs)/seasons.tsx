import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Avatar,
  AwardCard,
  Card,
  Icon,
  Podium,
  ScreenHeader,
  SeasonMatchRow,
  SectionLabel,
  Txt,
  type IconName,
  type PodiumEntry,
} from "@/components";
import {
  getLeaguePlayers,
  getSeasonMatches,
  getSeasonPotm,
  getSeasonResult,
  getSeasons,
  getStandings,
  type LeagueMatch,
  type LeaguePlayer,
  type PotmResult,
  type Season,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { AWARD_META, computeSeasonAwards, type SeasonAward } from "@/lib/awards";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface PastSeason {
  season: Season;
  result: SeasonResult | null;
  potm: PotmResult[];
  thirdId: string | null;
  awards: SeasonAward[];
}

const RESULTS_PREVIEW = 5;
const RESULTS_MAX = 12;

interface SeasonsData {
  seasons: Season[];
  players: Map<string, LeaguePlayer>;
  standings: Standing[];
  matches: LeagueMatch[];
  past: PastSeason[];
}

export default function SeasonsRoute() {
  const router = useRouter();
  const [showAllResults, setShowAllResults] = useState(false);

  const { data, loading } = useFocusData<SeasonsData>(
    "seasons",
    useCallback(async () => {
      const [seasonRows, roster] = await Promise.all([getSeasons(), getLeaguePlayers()]);
      const activeSeason = seasonRows.find((season) => season.active) ?? null;
      const old = seasonRows.filter((season) => !season.active);
      const [table, liveMatches, archives] = await Promise.all([
        activeSeason ? getStandings(activeSeason.id) : Promise.resolve([]),
        activeSeason ? getSeasonMatches(activeSeason.id) : Promise.resolve([]),
        Promise.all(
          old.map(async (season) => {
            const [result, potm, frozen, seasonMatches] = await Promise.all([
              getSeasonResult(season.id),
              getSeasonPotm(season.id),
              getStandings(season.id),
              getSeasonMatches(season.id),
            ]);
            return {
              season,
              result,
              potm,
              thirdId: frozen[2]?.uid ?? null,
              awards: computeSeasonAwards(seasonMatches),
            };
          }),
        ),
      ]);
      return {
        seasons: seasonRows,
        players: new Map(roster.map((player) => [player.id, player])),
        standings: table,
        matches: liveMatches,
        past: archives,
      };
    }, []),
  );
  const seasons = data?.seasons ?? [];
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const standings = data?.standings ?? [];
  const matches = data?.matches ?? [];
  const past = data?.past ?? [];

  const active = seasons.find((season) => season.active) ?? null;
  const daysLeft = active
    ? Math.max(0, Math.ceil((active.end.getTime() - Date.now()) / 86_400_000))
    : 0;
  const totalDays = active
    ? Math.max(1, (active.end.getTime() - active.start.getTime()) / 86_400_000)
    : 1;
  const elapsedDays = active ? Math.max(0, (Date.now() - active.start.getTime()) / 86_400_000) : 0;
  const progress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  // Only ranked players can lead or take a podium spot (provisional players hold rank 0).
  const rankedStandings = standings.filter((standing) => standing.ranked);
  const leader = rankedStandings[0] ?? null;
  const leadingPlayer = leader ? players.get(leader.uid) : null;

  const podium: PodiumEntry[] = rankedStandings.slice(0, 3).flatMap((standing) => {
    const player = players.get(standing.uid);
    return player ? [{ player, elo: standing.elo }] : [];
  });
  const recent = matches.slice().reverse();
  const shownResults = showAllResults
    ? recent.slice(0, RESULTS_MAX)
    : recent.slice(0, RESULTS_PREVIEW);
  const awards = computeSeasonAwards(matches);

  const openPlayer = (playerId: string) => router.push(`/(app)/player/${playerId}` as Href);
  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
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

        {podium.length === 3 ? (
          <>
            <SectionLabel>If the season ended today</SectionLabel>
            <Card padded={false} style={styles.podiumCard}>
              <Podium entries={podium} onPick={openPlayer} />
            </Card>
          </>
        ) : null}

        {recent.length ? (
          <View style={{ marginTop: spacing.x2 }}>
            <SectionLabel
              action={
                <Txt variant="monoBold" size={11} color={colors.textDim}>
                  {recent.length} played
                </Txt>
              }
            >
              Recent results
            </SectionLabel>
            <View style={{ gap: 7 }}>
              {shownResults.map((match) => {
                const playerA = players.get(match.aId);
                const playerB = players.get(match.bId);
                if (!playerA || !playerB) return null;
                return (
                  <SeasonMatchRow
                    key={match.id}
                    match={match}
                    playerA={playerA}
                    playerB={playerB}
                    onPress={() => openMatch(match.id)}
                  />
                );
              })}
              {recent.length > RESULTS_PREVIEW ? (
                <Pressable
                  onPress={() => setShowAllResults((value) => !value)}
                  style={styles.showMore}
                >
                  <Txt variant="head" size={11} color={colors.accent}>
                    {showAllResults
                      ? "SHOW FEWER"
                      : `SHOW MORE (${Math.min(RESULTS_MAX, recent.length) - RESULTS_PREVIEW} MORE)`}
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {awards.length && active ? (
          <View style={{ marginTop: spacing.x2 }}>
            <SectionLabel
              action={
                <Txt variant="head" size={10.5} color={colors.textFaint} style={styles.kicker}>
                  LIVE · {active.name.toUpperCase()}
                </Txt>
              }
            >
              Season awards
            </SectionLabel>
            <View style={{ gap: spacing.sm }}>
              {awards.map((award) => (
                <AwardCard
                  key={award.key}
                  award={award}
                  winner={players.get(award.playerId)}
                  onPress={(item) => (item.matchId ? openMatch(item.matchId) : undefined)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: spacing.x2 }}>
          <SectionLabel>Past seasons</SectionLabel>
        </View>
        <View style={{ gap: spacing.md }}>
          {past.map(({ season, result, potm, thirdId, awards: seasonAwards }) => (
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
                  <PodiumChip
                    label="Champion"
                    player={players.get(result.championId)}
                    icon="trophy"
                    color="#ffd24a"
                  />
                  <PodiumChip
                    label="Runner-up"
                    player={players.get(result.runnerUpId)}
                    icon="medal"
                    color="#cdd6e0"
                  />
                  {thirdId ? (
                    <PodiumChip
                      label="Third"
                      player={players.get(thirdId)}
                      icon="medal"
                      color="#e0935b"
                    />
                  ) : null}
                </View>
              ) : (
                <Txt size={12} color={colors.textDim}>
                  Final result pending.
                </Txt>
              )}
              {seasonAwards.length ? (
                <View style={styles.awardPills}>
                  {seasonAwards.slice(0, 3).map((award) => {
                    const meta = AWARD_META[award.key];
                    const winner = players.get(award.playerId);
                    return winner ? (
                      <View key={award.key} style={styles.awardPill}>
                        <Icon name={meta.icon} size={13} color={meta.accent} />
                        <Txt variant="bodyMedium" size={11}>
                          {firstName(winner.name)}
                        </Txt>
                      </View>
                    ) : null;
                  })}
                  {seasonAwards.length > 3 ? (
                    <Txt size={11} color={colors.textFaint}>
                      +{seasonAwards.length - 3} more
                    </Txt>
                  ) : null}
                </View>
              ) : null}
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
    </SafeAreaView>
  );
}

function PodiumChip({
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
  if (!player) return null;
  return (
    <View style={styles.podiumChip}>
      <Avatar player={player} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name={icon} size={12} color={color} />
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
  podiumCard: {
    paddingTop: spacing.lg,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  showMore: {
    alignSelf: "center",
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
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
  podiumChip: {
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
  awardPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 7,
    marginTop: spacing.md,
  },
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
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  potm: { flexDirection: "row", alignItems: "center", gap: 4 },
});
