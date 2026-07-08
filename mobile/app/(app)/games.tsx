import { useCallback } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Icon, ScreenHeader, SeasonMatchRow, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getLeaguePlayers,
  getPlayerMatches,
  type LeagueMatch,
  type LeaguePlayer,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { firstName } from "@/lib/format";
import { colors, spacing } from "@/theme";

interface GamesData {
  players: Map<string, LeaguePlayer>;
  matches: LeagueMatch[];
}

export default function GamesRoute() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ uid?: string }>();
  const uid = params.uid ?? user?.uid ?? "";

  const { data, loading } = useFocusData<GamesData>(
    `games:${uid}`,
    useCallback(async () => {
      if (!uid) return { players: new Map<string, LeaguePlayer>(), matches: [] };
      const [roster, played] = await Promise.all([getLeaguePlayers(), getPlayerMatches(uid)]);
      return {
        players: new Map(roster.map((player) => [player.id, player])),
        matches: played.slice().reverse(),
      };
    }, [uid]),
  );
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const matches = data?.matches ?? [];

  const isYou = uid === user?.uid;
  const player = players.get(uid);
  const title = isYou ? "Your games" : player ? `${firstName(player.name)}'s games` : "Games";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={title}
        subtitle={matches.length ? `${matches.length} confirmed · newest first` : undefined}
        back
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {!loading ? (
          <View style={{ gap: 7 }}>
            {matches.map((match) => {
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
              <Card style={styles.empty}>
                <Icon name="ball" size={24} color={colors.textDim} />
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={14}>
                    No confirmed games yet
                  </Txt>
                  <Txt size={12} color={colors.textDim} style={{ marginTop: 3 }}>
                    Confirmed results show up here, newest first.
                  </Txt>
                </View>
              </Card>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  empty: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
