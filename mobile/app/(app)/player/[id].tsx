import { Pressable, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { Avatar, Icon, SectionLabel, Txt } from "@/components";
import { PlayerProfileScreen } from "@/screens/PlayerProfileScreen";
import type { HeadToHead, LeaguePlayer } from "@/lib/league";
import { computeNemesisVictim, type RivalRecord } from "@/lib/stats/rivalry";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

export default function PlayerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The profile screen owns loading; this route contributes the Rivals card computed from
  // the same head-to-head docs the screen already fetched — no second round of queries.
  return (
    <PlayerProfileScreen
      uid={id}
      rivalsSlot={(pairs, players) => <RivalsCard uid={id} pairs={pairs} players={players} />}
    />
  );
}

type RivalKind = "nemesis" | "victim";

/** Worst and best records across this player's pairings, each tapping into a prefilled h2h. */
function RivalsCard({
  uid,
  pairs,
  players,
}: {
  uid: string;
  pairs: HeadToHead[];
  players: Map<string, LeaguePlayer>;
}) {
  const router = useRouter();
  const { nemesis, victim } = computeNemesisVictim(uid, pairs);
  // One qualifying opponent is both their best and worst matchup — collapse to a single row
  // instead of naming the same person twice.
  const solo = nemesis && victim && nemesis.opponentId === victim.opponentId;

  const entries: Array<{ kind: RivalKind | "rival"; record: RivalRecord }> = [];
  if (nemesis && !solo) entries.push({ kind: "nemesis", record: nemesis });
  if (victim) entries.push({ kind: solo ? "rival" : "victim", record: victim });
  if (entries.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel>Rivals</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        {entries.map(({ kind, record }) => {
          const opponent = players.get(record.opponentId);
          if (!opponent) return null;
          const tone =
            kind === "nemesis" ? colors.loss : kind === "victim" ? colors.win : colors.gold;
          return (
            <Pressable
              key={kind}
              onPress={() =>
                router.push({
                  pathname: "/(app)/h2h",
                  params: { a: uid, b: record.opponentId },
                } as Href)
              }
              style={styles.rivalRow}
            >
              <Avatar player={opponent} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                  {opponent.name}
                </Txt>
                <Txt variant="mono" size={10.5} color={colors.textDim}>
                  {record.sharePercent}% points · {record.games} games
                </Txt>
              </View>
              <View style={[styles.badge, { borderColor: withAlpha(tone, 0.35) }]}>
                <Txt variant="monoBold" size={8} color={tone}>
                  {kind.toUpperCase()}
                </Txt>
              </View>
              <Txt variant="monoBold" size={18}>
                <Txt
                  variant="monoBold"
                  size={18}
                  color={
                    record.wins > record.losses
                      ? colors.win
                      : record.wins < record.losses
                        ? colors.loss
                        : colors.text
                  }
                >
                  {record.wins}
                </Txt>
                <Txt variant="monoBold" size={18} color={colors.textFaint}>
                  {" – "}
                </Txt>
                {record.losses}
              </Txt>
              <Icon name="chevron" size={15} color={colors.textFaint} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rivalRow: {
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
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
  },
});
