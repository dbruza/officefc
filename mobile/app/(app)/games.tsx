/**
 * A player's confirmed games across all seasons, newest first, grouped by season. Phones
 * keep the compact two-sided result rows; desktop gets a proper table read from the
 * player's side (date · opponent · teams · score · result · ELO change) with a W-D-L
 * summary per season.
 */
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  Card,
  EloDelta,
  EmptyState,
  ErrorCard,
  Icon,
  IconButton,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SeasonMatchRow,
  SectionLabel,
  SkeletonRows,
  Tag,
  Txt,
} from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getLeaguePlayers,
  getPlayerMatches,
  getSeasons,
  type LeagueMatch,
  type LeaguePlayer,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { useBreakpoint } from "@/lib/responsive";
import { firstName } from "@/lib/format";
import { colors, fonts, resultColor, spacing } from "@/theme";
import type { MatchResult } from "@/types";

interface GamesData {
  players: Map<string, LeaguePlayer>;
  matches: LeagueMatch[];
  seasonNames: Map<string, string>;
}

interface SeasonGroup {
  seasonId: string;
  name: string;
  matches: LeagueMatch[];
  record: Record<MatchResult, number>;
}

function resultFor(match: LeagueMatch, uid: string): MatchResult {
  const mine = match.aId === uid ? match.aGoals : match.bGoals;
  const theirs = match.aId === uid ? match.bGoals : match.aGoals;
  return mine > theirs ? "W" : mine < theirs ? "L" : "D";
}

/** Consecutive runs by season (matches are newest first, so seasons stay contiguous). */
function groupBySeason(
  matches: LeagueMatch[],
  seasonNames: Map<string, string>,
  uid: string,
): SeasonGroup[] {
  const groups: SeasonGroup[] = [];
  for (const match of matches) {
    let group = groups[groups.length - 1];
    if (!group || group.seasonId !== match.seasonId) {
      group = {
        seasonId: match.seasonId,
        name: seasonNames.get(match.seasonId) ?? "Earlier season",
        matches: [],
        record: { W: 0, D: 0, L: 0 },
      };
      groups.push(group);
    }
    group.matches.push(match);
    group.record[resultFor(match, uid)] += 1;
  }
  return groups;
}

export default function GamesRoute() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDesktop } = useBreakpoint();
  const params = useLocalSearchParams<{ uid?: string }>();
  const uid = params.uid ?? user?.uid ?? "";

  const { data, refreshing, error, stale, reload } = useFocusData<GamesData>(
    `games:${uid}`,
    useCallback(async () => {
      if (!uid)
        return {
          players: new Map<string, LeaguePlayer>(),
          matches: [],
          seasonNames: new Map<string, string>(),
        };
      const [roster, played, seasons] = await Promise.all([
        getLeaguePlayers(),
        getPlayerMatches(uid),
        getSeasons(),
      ]);
      return {
        players: new Map(roster.map((player) => [player.id, player])),
        matches: played.slice().reverse(),
        seasonNames: new Map(seasons.map((season) => [season.id, season.name])),
      };
    }, [uid]),
  );
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const matches = (data?.matches ?? []).filter(
    (match) => players.has(match.aId) && players.has(match.bId),
  );
  const groups = groupBySeason(matches, data?.seasonNames ?? new Map(), uid);

  const isYou = uid === user?.uid;
  const player = players.get(uid);
  const title = isYou ? "Your games" : player ? `${firstName(player.name)}'s games` : "Games";
  const openMatch = (id: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id } } as Href);

  let body;
  // `loading` only flips once the fetch is scheduled; no data and no error means "loading".
  if (!data && !error) {
    body = <SkeletonRows count={8} height={56} />;
  } else if (error && !data) {
    body = (
      <ErrorCard
        message="Couldn't load the games. Check your connection and retry."
        onRetry={() => void reload()}
        retrying={refreshing}
      />
    );
  } else if (matches.length === 0) {
    body = (
      <EmptyState
        icon="ball"
        title="No confirmed games yet"
        body={
          isYou
            ? "Results show up here once your opponent confirms them."
            : `${player ? firstName(player.name) : "This player"} hasn't got a confirmed result yet.`
        }
        action={
          isYou
            ? {
                label: "Log a match",
                icon: "plus",
                onPress: () => router.push("/(app)/log-match"),
              }
            : undefined
        }
      />
    );
  } else {
    body = (
      <View style={[{ gap: spacing.x2 }, stale && { opacity: 0.5 }]}>
        {error ? (
          <ErrorCard
            message="Showing saved results — the latest refresh failed."
            onRetry={() => void reload()}
            retrying={refreshing}
          />
        ) : null}
        {groups.map((group, groupIndex) => (
          <Reveal key={`${group.seasonId}-${groupIndex}`} index={groupIndex}>
            <SectionLabel
              action={
                <Txt variant="mono" size={11.5} color={colors.textDim}>
                  {group.record.W}W {group.record.D}D {group.record.L}L
                </Txt>
              }
            >
              {group.name}
            </SectionLabel>
            {isDesktop ? (
              <GamesTable matches={group.matches} uid={uid} players={players} onOpen={openMatch} />
            ) : (
              <View style={{ gap: 7 }}>
                {group.matches.map((match) => (
                  <SeasonMatchRow
                    key={match.id}
                    match={match}
                    playerA={players.get(match.aId)!}
                    playerB={players.get(match.bId)!}
                    onPress={() => openMatch(match.id)}
                  />
                ))}
              </View>
            )}
          </Reveal>
        ))}
      </View>
    );
  }

  return (
    <Page
      header={
        <ScreenHeader
          title={title}
          subtitle={matches.length ? `${matches.length} confirmed · newest first` : undefined}
          onRefresh={() => void reload()}
          refreshing={refreshing}
          right={
            <IconButton
              icon="trend"
              accessibilityLabel="League analytics"
              color={colors.accent}
              onPress={() => router.push("/(app)/analytics" as Href)}
            />
          }
        />
      }
      onRefresh={() => void reload()}
      refreshing={refreshing}
    >
      {body}
    </Page>
  );
}

/** Desktop: one season's games as a table, read from `uid`'s side. */
function GamesTable({
  matches,
  uid,
  players,
  onOpen,
}: {
  matches: LeagueMatch[];
  uid: string;
  players: Map<string, LeaguePlayer>;
  onOpen: (id: string) => void;
}) {
  return (
    <Card padded={false} style={styles.table}>
      <View style={[styles.tr, styles.thead]} accessibilityRole="none">
        <Txt style={[styles.th, styles.colDate]}>DATE</Txt>
        <Txt style={[styles.th, styles.colOpp]}>OPPONENT</Txt>
        <Txt style={[styles.th, styles.colTeams]}>TEAMS</Txt>
        <Txt style={[styles.th, styles.colScore, styles.center]}>SCORE</Txt>
        <Txt style={[styles.th, styles.colDelta, styles.right]}>ELO</Txt>
        <View style={styles.colChevron} />
      </View>
      {matches.map((match, index) => {
        const iAmA = match.aId === uid;
        const opponent = players.get(iAmA ? match.bId : match.aId);
        const result = resultFor(match, uid);
        const mine = iAmA ? match.aGoals : match.bGoals;
        const theirs = iAmA ? match.bGoals : match.aGoals;
        const delta = iAmA ? match.aDelta : match.bDelta;
        return (
          <Interactive
            key={match.id}
            onPress={() => onOpen(match.id)}
            accessibilityRole="link"
            accessibilityLabel={`${result === "W" ? "Won" : result === "L" ? "Lost" : "Drew"} ${mine}–${theirs} against ${opponent?.name ?? "opponent"}`}
            pressScale={1}
            style={[styles.tr, index > 0 && styles.rowDivider]}
            hoverStyle={{ backgroundColor: colors.surface2 }}
          >
            {({ hovered }) => (
              <>
                <Txt variant="mono" size={12} color={colors.textDim} style={styles.colDate}>
                  {match.date
                    ? match.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                    : "—"}
                </Txt>
                <View style={[styles.colOpp, styles.oppCell]}>
                  <Avatar player={opponent} size={28} />
                  <Txt variant="bodyMedium" size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {opponent?.name ?? "Unknown"}
                  </Txt>
                  {match.source === "ai_assisted" ? <Tag tone="accent">AI</Tag> : null}
                </View>
                <Txt size={12.5} color={colors.textDim} numberOfLines={1} style={styles.colTeams}>
                  {iAmA ? match.aTeam : match.bTeam}
                  <Txt size={12.5} color={colors.textFaint}>
                    {"  vs  "}
                  </Txt>
                  {iAmA ? match.bTeam : match.aTeam}
                </Txt>
                <View style={[styles.colScore, styles.scoreCell]}>
                  <View style={[styles.resultChip, { backgroundColor: resultColor[result] }]}>
                    <Txt variant="monoBold" size={10.5} color={colors.onAccent}>
                      {result}
                    </Txt>
                  </View>
                  <Txt variant="monoBold" size={15}>
                    {mine}–{theirs}
                  </Txt>
                </View>
                <View style={[styles.colDelta, { alignItems: "flex-end" }]}>
                  {delta !== null ? <EloDelta delta={delta} size={12.5} /> : null}
                </View>
                <View style={styles.colChevron}>
                  <Icon
                    name="chevron"
                    size={14}
                    color={hovered ? colors.textDim : colors.textDisabled}
                  />
                </View>
              </>
            )}
          </Interactive>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  table: { overflow: "hidden" },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  thead: { minHeight: 38, backgroundColor: colors.surface2 },
  th: { fontSize: 10.5, letterSpacing: 1.1, color: colors.textDim, fontFamily: fonts.head },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  colDate: { width: 64 },
  colOpp: { flex: 1.3, minWidth: 0 },
  colTeams: { flex: 1.7, minWidth: 0 },
  colScore: { width: 92 },
  colDelta: { width: 70 },
  colChevron: { width: 14, alignItems: "flex-end" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
  oppCell: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scoreCell: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  resultChip: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
