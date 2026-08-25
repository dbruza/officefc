import { useCallback, useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar, Button, Card, Icon, ScreenHeader, SectionLabel, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  forceAdvanceCup,
  getActiveSeason,
  getCup,
  getLeaguePlayers,
  type CupState,
  type CupTie,
  type LeaguePlayer,
  type Season,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface CupData {
  season: Season | null;
  cup: CupState | null;
  players: LeaguePlayer[];
}

/** Label a round by its distance from the final: the last round is the Final, one before
 *  it the Semi Finals, then Quarter Finals, and everything earlier is an opening/numbered
 *  round (an 8-entrant cup's first round is NOT the semis). */
function roundLabel(index: number, total: number): string {
  const fromEnd = total - 1 - index; // 0 = Final, 1 = Semis, 2 = Quarters...
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi Finals";
  if (fromEnd === 2) return "Quarter Finals";
  return index === 0 ? "Opening Round" : `Round ${index + 1}`;
}

export default function CupScreen() {
  const router = useRouter();
  const { user, membership } = useAuth();
  const isAdmin = membership?.role === "admin";

  const { data, loading, error, reload } = useFocusData<CupData>(
    "cup-bracket",
    useCallback(async () => {
      const season = await getActiveSeason();
      const [cup, players] = await Promise.all([
        season ? getCup(season.id) : Promise.resolve(null),
        getLeaguePlayers(),
      ]);
      return { season, cup, players };
    }, []),
  );

  const season = data?.season ?? null;
  const cup = data?.cup ?? null;
  const players = useMemo(() => data?.players ?? [], [data?.players]);
  const playerById = new Map(players.map((player) => [player.id, player]));

  const myOpenTie =
    cup && user
      ? cup.rounds
          .flatMap((round, r) => round.map((tie, t) => ({ tie, r, t })))
          .find(
            ({ tie }) =>
              tie.winnerId === null &&
              (tie.aId === user.uid || tie.bId === user.uid) &&
              tie.aId !== null &&
              tie.bId !== null,
          )
      : null;

  function confirmForce(tieIndex: number, roundIndex: number, tie: CupTie) {
    const options = [tie.aId, tie.bId].filter((id): id is string => id !== null);
    Alert.alert("Force advance", "Decide this tie without a match? This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      // Both winner options are equally irreversible — neither gets the safe-looking
      // "cancel" styling, or the bold option reads as the dismissable one.
      ...options.map((winnerId) => ({
        text: playerById.get(winnerId)?.name ?? winnerId,
        style: "destructive" as const,
        onPress: () => {
          if (!season) return;
          forceAdvanceCup(season.id, roundIndex, tieIndex, winnerId)
            .then(() => reload())
            .catch((err: unknown) =>
              Alert.alert(
                "Force advance failed",
                err instanceof Error ? err.message : "Try again.",
              ),
            );
        },
      })),
    ]);
  }

  // The bracket itself is the source of truth: the final's winnerId decides the banner.
  const championId = cup ? championOf(cup) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Cup" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading && !data ? <ActivityIndicator color={colors.accent} /> : null}

        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load the cup bracket. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!error && !loading && (!season || !cup) ? (
          <View style={styles.empty}>
            <Icon name="trophy" size={34} color={colors.textDim} />
            <Txt variant="head" size={17} style={{ marginTop: spacing.md }}>
              No cup running
            </Txt>
            <Txt
              color={colors.textDim}
              size={12.5}
              style={{ marginTop: spacing.sm, textAlign: "center", lineHeight: 18 }}
            >
              An admin can start a mid-season knockout alongside the league table. Everyone enters
              the random draw; win your tie or you're out.
            </Txt>
          </View>
        ) : null}

        {cup && season ? (
          <>
            {championId ? (
              <View style={styles.championCard}>
                <Icon name="trophy" size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={10.5} color={colors.textDim}>
                    CUP CHAMPION
                  </Txt>
                  <Txt variant="bodyMedium" size={15} style={{ marginTop: 3 }}>
                    {playerById.get(championId)?.name ?? championId}
                  </Txt>
                </View>
                <Txt size={11} color={colors.textDim}>
                  won the cup
                </Txt>
              </View>
            ) : null}

            {myOpenTie && !championId ? (
              <Pressable
                onPress={() => router.push("/log-match")}
                style={styles.ctaCard}
                accessibilityRole="button"
              >
                <Icon name="swords" size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Txt variant="head" size={14}>
                    Your cup tie is live
                  </Txt>
                  <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }}>
                    Log the result as a normal match — the bracket advances once it's confirmed.
                  </Txt>
                </View>
                <Icon name="chevron" size={16} color={colors.textDim} />
              </Pressable>
            ) : null}

            {cup.rounds.map((round, r) => (
              <View key={`round-${r}`} style={{ marginTop: spacing.xl }}>
                <SectionLabel>{roundLabel(r, cup.rounds.length)}</SectionLabel>
                {round.map((tie, t) => (
                  <TieRow
                    key={`tie-${r}-${t}`}
                    tie={tie}
                    playerById={playerById}
                    isAdmin={isAdmin}
                    onForce={() => confirmForce(t, r, tie)}
                  />
                ))}
              </View>
            ))}

            <Txt size={11} color={colors.textDim} style={styles.faqLine}>
              Any confirmed match between a paired pair advances their tie — including one logged as
              a league game. Cup results also count toward the table and ELO.
            </Txt>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The final's winner once decided; null while any earlier round is still in play. */
function championOf(cup: CupState): string | null {
  const final = cup.rounds[cup.rounds.length - 1];
  return final?.length === 1 ? final[0].winnerId : null;
}

function TieRow({
  tie,
  playerById,
  isAdmin,
  onForce,
}: {
  tie: CupTie;
  playerById: Map<string, LeaguePlayer>;
  isAdmin: boolean;
  onForce: () => void;
}) {
  const unresolved = tie.winnerId === null;
  const playable = unresolved && tie.aId !== null && tie.bId !== null;
  const sides: Array<{ id: string | null }> = [{ id: tie.aId }, { id: tie.bId }];

  return (
    <View style={[styles.tieCard, playable && styles.tieCardOpen]}>
      <View style={styles.sidesRow}>
        {sides.map((side, i) => {
          const player = side.id ? (playerById.get(side.id) ?? null) : null;
          const isWinner = tie.winnerId !== null && tie.winnerId === side.id;
          const isLoser = tie.winnerId !== null && tie.winnerId !== side.id;
          return (
            <View key={`${side.id ?? "tbd"}-${i}`} style={[styles.sideCell, isLoser && styles.dim]}>
              {i === 1 ? <View style={styles.vsPill} /> : null}
              <Avatar player={player} size={30} jersey />
              <Txt
                variant={isWinner ? "bodyMedium" : "body"}
                size={13}
                style={[{ flex: 1 }, isWinner && styles.winnerName, unresolved && styles.dimText]}
                numberOfLines={1}
              >
                {side.id
                  ? firstName(player?.name ?? side.id)
                  : tie.aId === null && tie.bId === null
                    ? "Awaiting qualifiers"
                    : "Awaiting a result"}
              </Txt>
              {isWinner ? <Icon name="check" size={14} color={colors.win} /> : null}
            </View>
          );
        })}
      </View>
      <Txt size={10.5} color={playable ? colors.accent : colors.textFaint} style={styles.hint}>
        {playable ? "Play this tie — log it as a normal match" : unresolved ? " " : "Decided"}
      </Txt>
      {isAdmin && playable ? (
        <Pressable onPress={onForce} style={styles.forceBtn} accessibilityRole="button">
          <Txt size={10} color={colors.textDim}>
            Force advance
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  empty: { alignItems: "center", paddingVertical: spacing.x3, paddingHorizontal: spacing.xl },
  championCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.accent, 0.06),
  },
  ctaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.45),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  tieCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tieCardOpen: { borderColor: withAlpha(colors.accent, 0.35) },
  sidesRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sideCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    position: "relative",
  },
  vsPill: { width: 1, height: 24, backgroundColor: colors.line, marginRight: spacing.xs },
  dim: { opacity: 0.45 },
  dimText: { color: colors.textDim },
  winnerName: { textDecorationLine: "underline" },
  hint: { marginTop: spacing.sm },
  forceBtn: {
    alignSelf: "flex-end",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  faqLine: { marginTop: spacing.xl, textAlign: "center", lineHeight: 16 },
});
