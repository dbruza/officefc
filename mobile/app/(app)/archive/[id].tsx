import { useCallback } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AwardCard,
  Card,
  PlayerRow,
  Podium,
  ScreenHeader,
  SectionLabel,
  Txt,
  type PodiumEntry,
  Button,
} from "@/components";
import {
  getLeaguePlayers,
  getSeason,
  getSeasonMatches,
  getStandings,
  type LeagueMatch,
  type LeaguePlayer,
  type Season,
  type Standing,
} from "@/lib/league";
import { computeSeasonAwards } from "@/lib/awards";
import { useAuth } from "@/lib/auth";
import { useFocusData } from "@/lib/useFocusData";
import { colors, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

interface ArchiveData {
  season: Season | null;
  standings: Standing[];
  matches: LeagueMatch[];
  players: Map<string, LeaguePlayer>;
}

export default function ArchiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const { data, loading, error, reload } = useFocusData<ArchiveData>(
    `archive:${id}`,
    useCallback(async () => {
      const [seasonRow, table, seasonMatches, roster] = await Promise.all([
        getSeason(id),
        getStandings(id),
        getSeasonMatches(id),
        getLeaguePlayers(),
      ]);
      return {
        season: seasonRow,
        standings: table,
        matches: seasonMatches,
        players: new Map(roster.map((player) => [player.id, player])),
      };
    }, [id]),
  );
  const season = data?.season ?? null;
  const standings = data?.standings ?? [];
  const matches = data?.matches ?? [];
  const players = data?.players ?? new Map<string, LeaguePlayer>();

  // Only ranked players hold a place in a finalized season's table and podium.
  const rankedStandings = standings.filter((standing) => standing.ranked);
  const podium: PodiumEntry[] = rankedStandings.slice(0, 3).flatMap((standing) => {
    const player = players.get(standing.uid);
    return player ? [{ player, elo: standing.elo }] : [];
  });
  const awards = computeSeasonAwards(matches);
  const openPlayer = (playerId: string) => router.push(`/(app)/player/${playerId}` as Href);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={season?.name ?? "Season archive"}
        subtitle={season ? `${season.year} · final standings` : undefined}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load this season's archive. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}
        {!error && podium.length === 3 ? (
          <Card padded={false} style={styles.podiumCard}>
            <Podium entries={podium} onPick={openPlayer} />
          </Card>
        ) : null}

        {awards.length ? (
          <View style={{ marginBottom: spacing.lg }}>
            <SectionLabel>Season awards</SectionLabel>
            <View style={{ gap: spacing.sm }}>
              {awards.map((award) => (
                <AwardCard key={award.key} award={award} winner={players.get(award.playerId)} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.tableHead}>
          <Txt variant="head" size={9.5} color={colors.textDim}>
            FINAL TABLE
          </Txt>
          <Txt variant="head" size={9.5} color={colors.textDim}>
            W-D-L · ELO
          </Txt>
        </View>
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
                record={{ w: standing.w, d: standing.d, l: standing.l }}
                you={standing.uid === user?.uid}
              />
            );
          })}
          {!loading && !error && rankedStandings.length === 0 ? (
            <Card style={{ alignItems: "center", paddingVertical: spacing.x2 }}>
              <Txt color={colors.textDim}>No frozen standings are available for this season.</Txt>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  podiumCard: {
    paddingTop: spacing.lg,
    paddingHorizontal: 14,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  tableHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
