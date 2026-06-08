import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, Card, Icon, PlayerRow, ScreenHeader, Txt } from "@/components";
import {
  getLeaguePlayers,
  getSeason,
  getSeasonResult,
  getStandings,
  type LeaguePlayer,
  type Season,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { useAuth } from "@/lib/auth";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

export default function ArchiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [result, setResult] = useState<SeasonResult | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([getSeason(id), getSeasonResult(id), getStandings(id), getLeaguePlayers()])
        .then(([seasonRow, resultRow, table, roster]) => {
          setSeason(seasonRow);
          setResult(resultRow);
          setStandings(table);
          setPlayers(new Map(roster.map((player) => [player.id, player])));
        })
        .finally(() => setLoading(false));
    }, [id]),
  );

  const champion = result ? players.get(result.championId) : null;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={season?.name ?? "Season archive"}
        subtitle={season ? `${season.year} · final standings` : undefined}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {champion ? (
          <View style={styles.champion}>
            <Icon name="crown" size={20} color="#ffd24a" />
            <Avatar player={champion} size={40} jersey />
            <View style={{ flex: 1 }}>
              <Txt variant="head" size={9.5} color="#ffd24a" style={styles.kicker}>
                CHAMPION
              </Txt>
              <Txt variant="head" size={17}>
                {champion.name}
              </Txt>
            </View>
            <Icon name="trophy" size={29} color="#ffd24a" />
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
  champion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha("#ffd24a", 0.25),
    borderRadius: radius.lg,
    backgroundColor: mix(colors.surface, "#ffd24a", 7),
  },
  kicker: { letterSpacing: 1.2 },
  tableHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
