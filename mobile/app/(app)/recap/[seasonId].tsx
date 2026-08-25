/**
 * Season recap: a shareable highlight card for one finalized season. The hero View holds
 * every section (champion podium + derived awards) so it can be captured whole via
 * react-native-view-shot and handed to the OS share sheet; on web view-shot has no native
 * module, so the Share button is replaced by a static caption instead of a broken flow.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, Button, Card, Icon, ScreenHeader, Txt, type IconName } from "@/components";
import {
  getLeaguePlayers,
  getSeason,
  getSeasonResult,
  loadRecap,
  type BiggestUpsetRecap,
  type LeaguePlayer,
  type Season,
  type SeasonRecap,
  type SeasonResult,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { logger } from "@/lib/logger";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

interface RecapData {
  season: Season | null;
  result: SeasonResult | null;
  recap: SeasonRecap | null;
  players: Map<string, LeaguePlayer>;
}

/** One rendered row of the hero card; absent sections never produce a row. */
interface RecapRow {
  key: string;
  icon: IconName;
  accent: string;
  label: string;
  player?: LeaguePlayer;
  /** Fallback when no single player owns the fact (e.g. a rivalry pair). */
  pair?: [LeaguePlayer, LeaguePlayer];
  value: string;
  sub: string;
}

const GOLD = "#ffd24a";

function rowsFor(recap: SeasonRecap, players: Map<string, LeaguePlayer>): RecapRow[] {
  const find = (uid: string) => players.get(uid);
  const row: RecapRow[] = [];
  if (recap.goldenBoot) {
    const player = find(recap.goldenBoot.playerId);
    if (player)
      row.push({
        key: "goldenBoot",
        icon: "boot",
        accent: "#f5b400",
        label: "Golden Boot",
        player,
        value: String(recap.goldenBoot.goals),
        sub: "goals",
      });
  }
  if (recap.bestDefense) {
    const player = find(recap.bestDefense.playerId);
    if (player)
      row.push({
        key: "bestDefense",
        icon: "glove",
        accent: "#3fd0c9",
        label: "Golden Glove",
        player,
        value: String(recap.bestDefense.conceded),
        sub: "conceded",
      });
  }
  if (recap.mostImproved) {
    const player = find(recap.mostImproved.playerId);
    if (player) {
      const gain = recap.mostImproved.eloGain;
      row.push({
        key: "mostImproved",
        icon: "trend",
        accent: "#5b9dff",
        label: "Most Improved",
        player,
        value: `${gain >= 0 ? "+" : ""}${gain}`,
        sub: "ELO climb",
      });
    }
  }
  if (recap.longestWinStreak) {
    const player = find(recap.longestWinStreak.playerId);
    if (player)
      row.push({
        key: "longestWinStreak",
        icon: "flame",
        accent: "#ff6b35",
        label: "Longest Win Streak",
        player,
        value: String(recap.longestWinStreak.streak),
        sub: "in a row",
      });
  }
  if (recap.biggestRivalry) {
    // Both names must resolve or neither renders — half a rivalry is worse than none.
    const a = find(recap.biggestRivalry.aId);
    const b = find(recap.biggestRivalry.bId);
    if (a && b)
      row.push({
        key: "biggestRivalry",
        icon: "swords",
        accent: "#c06bff",
        label: "Biggest Rivalry",
        pair: [a, b],
        value: String(recap.biggestRivalry.games),
        sub: "meetings",
      });
  }
  if (recap.gameOfTheSeason) {
    const game = recap.gameOfTheSeason;
    const a = find(game.aId);
    const b = find(game.bId);
    if (a && b)
      row.push({
        key: "gameOfTheSeason",
        icon: "ball",
        accent: "#22e06a",
        label: "Game of the Season",
        pair: [a, b],
        value: `${game.aGoals}-${game.bGoals}`,
        sub: "final score",
      });
  }
  if (recap.biggestUpset) {
    const upset: BiggestUpsetRecap = recap.biggestUpset;
    const winner = find(upset.winnerId);
    if (winner)
      row.push({
        key: "biggestUpset",
        icon: "bolt",
        accent: GOLD,
        label: "Biggest Upset",
        player: winner,
        value: `${upset.winnerGoals}-${upset.loserGoals}`,
        sub: `over ${firstName(find(upset.loserId)?.name ?? "the table")}`,
      });
  }
  return row;
}

export default function RecapRoute() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const { data, loading, error, reload } = useFocusData<RecapData>(
    `recap:${seasonId}`,
    useCallback(async () => {
      const [seasonRow, result, recap, roster] = await Promise.all([
        getSeason(seasonId),
        getSeasonResult(seasonId),
        loadRecap(seasonId),
        getLeaguePlayers(),
      ]);
      return {
        season: seasonRow,
        result,
        recap,
        players: new Map(roster.map((player) => [player.id, player])),
      };
    }, [seasonId]),
  );

  const season = data?.season ?? null;
  const result = data?.result ?? null;
  const recap = data?.recap ?? null;
  const players = useMemo(() => data?.players ?? new Map<string, LeaguePlayer>(), [data]);
  const rows = useMemo(() => (recap ? rowsFor(recap, players) : []), [recap, players]);

  const champion = result ? players.get(result.championId) : undefined;
  const runnerUp = result ? players.get(result.runnerUpId) : undefined;
  const premier = result?.premierId ? players.get(result.premierId) : undefined;

  const shareCard = async () => {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      // Required dynamically: view-shot is a native module — importing it at module scope
      // would break the web bundle even behind a Platform guard.
      const { captureRef } = await import("react-native-view-shot");
      const uri = await captureRef(cardRef.current, { format: "png", quality: 1 });
      const Sharing = await import("expo-sharing");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Season recap" });
      } else {
        Alert.alert("Sharing unavailable", "Sharing isn't supported on this device.");
      }
    } catch (shareError) {
      logger.warn("recap_share_failed", { error: String(shareError) });
      Alert.alert("Couldn't share", "Something went wrong preparing the card. Try again.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Season recap" subtitle={season?.name ?? undefined} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? (
          <Card style={{ borderColor: withAlpha(colors.loss, 0.35), marginBottom: spacing.lg }}>
            <Txt color={colors.loss} size={13}>
              Couldn't load this recap. Check the connection and retry.
            </Txt>
            <Button variant="dark" size="sm" style={{ marginTop: spacing.md }} onPress={reload}>
              Retry
            </Button>
          </Card>
        ) : null}

        {!loading && !error && !result ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.x2 }}>
            <Icon name="trophy" size={26} color={colors.textFaint} />
            <Txt variant="head" size={15} style={{ marginTop: spacing.sm }}>
              Nothing to recap yet
            </Txt>
            <Txt size={12} color={colors.textDim} style={{ marginTop: 4, textAlign: "center" }}>
              This season hasn't been finalized, so there's no recap card to show.
            </Txt>
          </Card>
        ) : null}

        {!error && result ? (
          <>
            <View ref={cardRef} collapsable={false} style={styles.captureRoot}>
              <View style={styles.hero}>
                <Txt variant="head" size={10} color={colors.accent} style={styles.kicker}>
                  ● SEASON RECAP
                </Txt>
                <Txt variant="head" size={24} style={styles.seasonName}>
                  {season?.name ?? result.seasonId}
                </Txt>
                <View style={styles.podiumRow}>
                  <HeroChip
                    label="Champion"
                    player={champion}
                    icon="trophy"
                    tint={GOLD}
                    fallback="TBD"
                  />
                  <HeroChip
                    label="Premier"
                    player={premier}
                    icon="crown"
                    tint="#00ff87"
                    fallback={result.format === "finals" ? "—" : undefined}
                  />
                  <HeroChip
                    label="Runner-up"
                    player={runnerUp}
                    icon="medal"
                    tint="#cdd6e0"
                    fallback="—"
                  />
                </View>
                {rows.length ? (
                  <View style={styles.statGrid}>
                    {rows.map((row) => (
                      <RecapStatRow key={row.key} row={row} />
                    ))}
                  </View>
                ) : (
                  <Txt size={12} color={colors.textDim} style={styles.emptyNote}>
                    No award facts were recorded for this season.
                  </Txt>
                )}
              </View>
            </View>

            {Platform.OS === "web" ? (
              <Txt size={12} color={colors.textFaint} style={styles.shareCaption}>
                Sharing available on mobile
              </Txt>
            ) : (
              <Button
                icon={sharing ? undefined : "photo"}
                variant="primary"
                size="md"
                full
                disabled={sharing}
                onPress={() => void shareCard()}
              >
                {sharing ? "Preparing…" : "Share recap"}
              </Button>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroChip({
  label,
  player,
  icon,
  tint,
  fallback,
}: {
  label: string;
  player: LeaguePlayer | undefined;
  icon: IconName;
  tint: string;
  /** Shown when the slot is legitimately empty (e.g. no Premier in table format). */
  fallback?: string;
}) {
  if (!player && !fallback) return null;
  return (
    <View style={styles.chip}>
      {player ? (
        <Avatar player={player} size={30} />
      ) : (
        <View style={[styles.chipGhost, { borderColor: withAlpha(tint, 0.4) }]}>
          <Icon name={icon} size={14} color={tint} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="head" size={8.5} color={colors.textDim} style={styles.chipLabel}>
          {label.toUpperCase()}
        </Txt>
        <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
          {player ? firstName(player.name) : (fallback ?? "")}
        </Txt>
      </View>
    </View>
  );
}

function RecapStatRow({ row }: { row: RecapRow }) {
  return (
    <View style={styles.statRow}>
      <View style={[styles.statIcon, { borderColor: withAlpha(row.accent, 0.45) }]}>
        <Icon name={row.icon} size={14} color={row.accent} />
      </View>
      <View style={styles.statBody}>
        <Txt variant="head" size={8.5} color={colors.textDim} style={styles.chipLabel}>
          {row.label.toUpperCase()}
        </Txt>
        <View style={styles.statNames}>
          {row.player ? (
            <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
              {firstName(row.player.name)}
            </Txt>
          ) : null}
          {row.pair ? (
            <Txt variant="bodyMedium" size={12.5} numberOfLines={1}>
              {`${firstName(row.pair[0].name)} × ${firstName(row.pair[1].name)}`}
            </Txt>
          ) : null}
          <Txt variant="mono" size={11} color={colors.textFaint}>
            {row.sub}
          </Txt>
        </View>
      </View>
      <Txt variant="monoBold" size={17} color={row.accent}>
        {row.value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  captureRoot: {
    // The captured bitmap needs opaque pixels: a transparent root bakes the OS window colour
    // into the PNG instead of the card's own surface.
    backgroundColor: colors.bg,
    paddingBottom: spacing.sm,
  },
  hero: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  kicker: { letterSpacing: 1.1 },
  seasonName: { marginTop: 3 },
  podiumRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  chip: {
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
  chipGhost: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipLabel: { letterSpacing: 1.1 },
  statGrid: { gap: spacing.sm, marginTop: spacing.lg },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  statBody: { flex: 1, minWidth: 0, gap: 1 },
  statNames: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  emptyNote: { marginTop: spacing.lg, textAlign: "center" },
  shareCaption: { textAlign: "center", marginTop: spacing.sm },
});
