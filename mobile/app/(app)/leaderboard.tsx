import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Card, Icon, PlayerRow, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getActiveSeason,
  getLeaguePlayers,
  getStandings,
  type LeaguePlayer,
  type Season,
  type Standing,
} from "@/lib/league";
import { colors, spacing } from "@/theme";

export default function Leaderboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([getActiveSeason(), getLeaguePlayers()])
        .then(async ([activeSeason, roster]) => {
          setSeason(activeSeason);
          setPlayers(new Map(roster.map((player) => [player.id, player])));
          setStandings(activeSeason ? await getStandings(activeSeason.id) : []);
        })
        .finally(() => setLoading(false));
    }, []),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={20} />
        </Pressable>
        <View>
          <Txt variant="head" size={22}>
            Leaderboard
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            {season ? `${season.name} · ${season.year}` : "No active season"}
          </Txt>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {!loading && standings.length === 0 ? (
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
          {standings.map((standing) => {
            const player = players.get(standing.uid);
            if (!player) return null;
            return (
              <PlayerRow
                key={standing.uid}
                player={player}
                rank={standing.rank}
                elo={standing.elo}
                move={standing.move}
                form={standing.form}
                you={standing.uid === user?.uid}
              />
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
});
