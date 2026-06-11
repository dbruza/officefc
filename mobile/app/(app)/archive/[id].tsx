import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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
import { colors, spacing } from "@/theme";

export default function ArchiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([getSeason(id), getStandings(id), getSeasonMatches(id), getLeaguePlayers()])
        .then(([seasonRow, table, seasonMatches, roster]) => {
          setSeason(seasonRow);
          setStandings(table);
          setMatches(seasonMatches);
          setPlayers(new Map(roster.map((player) => [player.id, player])));
        })
        .finally(() => setLoading(false));
    }, [id]),
  );

  const podium: PodiumEntry[] = standings.slice(0, 3).flatMap((standing) => {
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
        {podium.length === 3 ? (
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
          {standings.map((standing) => {
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
          {!loading && standings.length === 0 ? (
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
