/**
 * Season archive: a finalized season's champion (with a link to its recap), the frozen
 * final table and podium, and the season's awards. Desktop splits table | champion +
 * awards; phones stack champion first.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  AwardCard,
  Button,
  Card,
  Columns,
  EmptyState,
  ErrorCard,
  Icon,
  Page,
  PlayerRow,
  Podium,
  Reveal,
  ScreenHeader,
  SectionLabel,
  SkeletonCard,
  SkeletonRows,
  Txt,
  sticky,
  type PodiumEntry,
} from "@/components";
import {
  getLeaguePlayers,
  getSeason,
  getSeasonMatches,
  getSeasonResult,
  getStandings,
  type LeagueMatch,
  type LeaguePlayer,
  type Season,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { computeSeasonAwards } from "@/lib/awards";
import { useAuth } from "@/lib/auth";
import { useBreakpoint } from "@/lib/responsive";
import { useFocusData } from "@/lib/useFocusData";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

interface ArchiveData {
  season: Season | null;
  result: SeasonResult | null;
  standings: Standing[];
  matches: LeagueMatch[];
  players: Map<string, LeaguePlayer>;
}

export default function ArchiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { isDesktop } = useBreakpoint();

  const { data, refreshing, error, reload } = useFocusData<ArchiveData>(
    `archive:${id}`,
    useCallback(async () => {
      const [seasonRow, result, table, seasonMatches, roster] = await Promise.all([
        getSeason(id),
        getSeasonResult(id),
        getStandings(id),
        getSeasonMatches(id),
        getLeaguePlayers(),
      ]);
      return {
        season: seasonRow,
        result,
        standings: table,
        matches: seasonMatches,
        players: new Map(roster.map((player) => [player.id, player])),
      };
    }, [id]),
  );
  const season = data?.season ?? null;
  const result = data?.result ?? null;
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const matches = data?.matches;
  const awards = useMemo(() => (matches ? computeSeasonAwards(matches) : []), [matches]);

  // Only ranked players hold a place in a finalized season's table and podium.
  const rankedStandings = (data?.standings ?? []).filter(
    (standing) => standing.ranked && players.has(standing.uid),
  );
  const podium: PodiumEntry[] = rankedStandings.slice(0, 3).flatMap((standing) => {
    const player = players.get(standing.uid);
    return player ? [{ player, elo: standing.elo }] : [];
  });
  const openPlayer = (playerId: string) => router.push(`/(app)/player/${playerId}` as Href);
  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);
  const openRecap = () => router.push(`/(app)/recap/${id}` as Href);

  const header = (
    <ScreenHeader
      title={season?.name ?? "Season archive"}
      subtitle={season ? `${formatRange(season)} · ${season.year} · final standings` : undefined}
      onRefresh={() => void reload()}
      refreshing={refreshing}
    />
  );

  let content: ReactNode;
  if (!data) {
    content = error ? (
      <ErrorCard
        message="Couldn't load this season's archive. Check the connection and retry."
        onRetry={() => void reload()}
        retrying={refreshing}
      />
    ) : (
      <View style={{ gap: spacing.lg }}>
        <SkeletonCard height={120} />
        <SkeletonCard height={230} />
        <SkeletonRows count={6} />
      </View>
    );
  } else if (!season) {
    content = (
      <EmptyState
        icon="seasons"
        title="Season not found"
        body="This season may have been removed, or the link is out of date."
        action={{ label: "All seasons", onPress: () => router.navigate("/(app)/(tabs)/seasons") }}
      />
    );
  } else {
    // Finals seasons crown the Grand Final winner, so the table's #1 can differ from the
    // champion — label the podium for what it is.
    const tableLabel = result?.format === "finals" ? "Regular-season table" : "Final table";

    const championBlock = (
      <Reveal>
        <ChampionCard
          result={result}
          players={players}
          onOpenPlayer={openPlayer}
          onRecap={openRecap}
        />
      </Reveal>
    );

    const tableBlock = (
      <View>
        {podium.length >= 2 ? (
          <Card style={styles.podiumCard}>
            <View style={styles.podiumInner}>
              <Podium entries={podium} onPick={openPlayer} />
            </View>
          </Card>
        ) : null}
        {rankedStandings.length > 0 ? (
          <>
            <SectionLabel
              action={
                <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
                  W-D-L · ELO
                </Txt>
              }
            >
              {tableLabel}
            </SectionLabel>
            <View style={{ gap: spacing.sm }}>
              {rankedStandings.map((standing, index) => {
                const player = players.get(standing.uid);
                if (!player) return null;
                return (
                  <Reveal key={standing.uid} index={index}>
                    <PlayerRow
                      player={player}
                      rank={standing.rank}
                      elo={standing.elo}
                      record={{ w: standing.w, d: standing.d, l: standing.l }}
                      you={standing.uid === user?.uid}
                      champion={standing.uid === result?.championId}
                      onPress={() => openPlayer(standing.uid)}
                    />
                  </Reveal>
                );
              })}
            </View>
          </>
        ) : (
          <EmptyState
            compact
            icon="board"
            title="No final table"
            body="No frozen standings are available for this season."
          />
        )}
      </View>
    );

    const awardsBlock =
      awards.length > 0 ? (
        <View>
          <SectionLabel>Season awards</SectionLabel>
          <View style={{ gap: spacing.sm }}>
            {awards.map((award, index) => (
              <Reveal key={award.key} index={index}>
                <AwardCard
                  award={award}
                  winner={players.get(award.playerId)}
                  onPress={(item) => (item.matchId ? openMatch(item.matchId) : undefined)}
                />
              </Reveal>
            ))}
          </View>
        </View>
      ) : null;

    content = isDesktop ? (
      <Columns ratio={[3, 2]} gap={spacing.x2}>
        {tableBlock}
        <View style={[{ gap: spacing.x2 }, sticky]}>
          {championBlock}
          {awardsBlock}
        </View>
      </Columns>
    ) : (
      <View style={{ gap: spacing.x2 }}>
        {championBlock}
        {tableBlock}
        {awardsBlock}
      </View>
    );
  }

  return (
    <Page header={header} refreshing={refreshing} onRefresh={() => void reload()}>
      {content}
    </Page>
  );
}

function ChampionCard({
  result,
  players,
  onOpenPlayer,
  onRecap,
}: {
  result: SeasonResult | null;
  players: Map<string, LeaguePlayer>;
  onOpenPlayer: (uid: string) => void;
  onRecap: () => void;
}) {
  const champion = result ? players.get(result.championId) : undefined;
  const runnerUp = result ? players.get(result.runnerUpId) : undefined;
  if (!result || !champion) {
    return (
      <EmptyState
        compact
        icon="trophy"
        title="Final result pending"
        body="The champion is crowned once an admin finalizes the season."
      />
    );
  }
  return (
    <Card style={styles.champion}>
      <View style={styles.championRow}>
        <Avatar player={champion} size={56} champion ring />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.kickerRow}>
            <Icon name="trophy" size={13} color={colors.gold} />
            <Txt variant="head" size={10.5} color={colors.gold} style={styles.kicker}>
              CHAMPION
            </Txt>
          </View>
          <Txt variant="head" size={21} numberOfLines={1} style={{ marginTop: 2 }}>
            {champion.name}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            {result.format === "finals" ? "Won the Grand Final" : "Topped the final table"}
            {runnerUp ? ` · runner-up ${runnerUp.name}` : ""}
          </Txt>
        </View>
      </View>
      <View style={styles.championActions}>
        <Button icon="sparkle" size="sm" onPress={onRecap} style={{ flex: 1 }}>
          Season recap
        </Button>
        <Button
          variant="dark"
          size="sm"
          icon="profile"
          onPress={() => onOpenPlayer(champion.id)}
          accessibilityLabel={`Open ${champion.name}'s profile`}
          style={{ flex: 1 }}
        >
          Champion profile
        </Button>
      </View>
    </Card>
  );
}

function formatRange(season: Season): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${format(season.start)} – ${format(season.end)}`;
}

const styles = StyleSheet.create({
  podiumCard: {
    paddingTop: spacing.lg,
    paddingBottom: 0,
    paddingHorizontal: 14,
    overflow: "hidden",
    marginBottom: spacing.x2,
  },
  podiumInner: { width: "100%", maxWidth: 460, alignSelf: "center" },
  kicker: { letterSpacing: 1.1 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  champion: {
    borderRadius: radius.xl,
    borderColor: withAlpha(colors.gold, 0.3),
    backgroundColor: mix(colors.surface, colors.gold, 7),
    gap: spacing.lg,
  },
  championRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  championActions: { flexDirection: "row", gap: spacing.sm },
});
