/**
 * A player's confirmed games across all seasons, newest first, grouped by season. Phones
 * keep the compact two-sided result rows; desktop gets a proper table read from the
 * player's side (date · opponent · teams · score · result · ELO change) with a W-D-L
 * summary per season.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import {
  Avatar,
  Button,
  Card,
  EloDelta,
  EmptyState,
  ErrorCard,
  Icon,
  IconButton,
  Interactive,
  Page,
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
  getPlayerMatchPage,
  getProfileSummary,
  type MatchPage,
  type ProfileSummary,
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
  uid: string;
  players: Map<string, LeaguePlayer>;
  page: MatchPage;
  summary: ProfileSummary | null;
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

  const {
    data: cachedData,
    refreshing,
    error,
    stale,
    reload,
  } = useFocusData<GamesData>(
    `games:${uid}`,
    useCallback(async () => {
      if (!uid)
        return {
          uid,
          players: new Map<string, LeaguePlayer>(),
          page: { matches: [], cursor: null, hasMore: false },
          summary: null,
          seasonNames: new Map<string, string>(),
        };
      const summary = await getProfileSummary(uid);
      const [roster, page, seasons] = await Promise.all([
        getLeaguePlayers(),
        getPlayerMatchPage(uid),
        getSeasons(),
      ]);
      return {
        uid,
        players: new Map(roster.map((player) => [player.id, player])),
        page,
        summary,
        seasonNames: new Map(seasons.map((season) => [season.id, season.name])),
      };
    }, [uid]),
  );
  const data = cachedData?.uid === uid ? cachedData : undefined;
  const players = data?.players ?? new Map<string, LeaguePlayer>();
  const [more, setMore] = useState<{
    base: MatchPage | undefined;
    page: MatchPage;
    rows: LeagueMatch[];
  } | null>(null);
  const [paging, setPaging] = useState(false),
    [pageError, setPageError] = useState(false);
  const pagingRef = useRef(false),
    generation = useRef(0),
    baseRef = useRef(data?.page);
  if (baseRef.current !== data?.page) {
    baseRef.current = data?.page;
    generation.current++;
  }
  const extra = more?.base === data?.page ? more : null;
  const page = extra?.page ?? data?.page;
  const matches = useMemo(() => {
    const byId = new Map(
      [...(data?.page.matches ?? []), ...(extra?.rows ?? [])].map((m) => [m.id, m]),
    );
    return [...byId.values()].filter((m) => players.has(m.aId) && players.has(m.bId));
  }, [data?.page, extra, players]);
  const groups = useMemo(
    () => groupBySeason(matches, data?.seasonNames ?? new Map(), uid),
    [matches, data?.seasonNames, uid],
  );
  const rows = useMemo(
    () =>
      groups.flatMap((group) =>
        group.matches.map((match, index) => ({ match, group, first: index === 0 })),
      ),
    [groups],
  );
  const loadMore = async () => {
    if (!page?.hasMore || pagingRef.current || !data) return;
    const gen = generation.current,
      base = data.page;
    pagingRef.current = true;
    setPaging(true);
    setPageError(false);
    try {
      const next = await getPlayerMatchPage(uid, page.cursor);
      if (generation.current === gen)
        setMore({ base, page: next, rows: [...(extra?.rows ?? []), ...next.matches] });
    } catch {
      if (generation.current === gen) setPageError(true);
    } finally {
      pagingRef.current = false;
      setPaging(false);
    }
  };

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
      </View>
    );
  }

  return (
    <Page
      scroll={false}
      header={
        <ScreenHeader
          title={title}
          subtitle={
            data?.summary ? `${data.summary.matchCount} confirmed · newest first` : undefined
          }
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
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={({ match }) => match.id}
        initialNumToRender={12}
        windowSize={7}
        maxToRenderPerBatch={12}
        refreshing={refreshing}
        onRefresh={() => void reload()}
        ListHeaderComponent={body}
        renderItem={({ item: { match, group, first } }) => {
          const record = data?.summary?.seasons[group.seasonId];
          return (
            <View style={{ marginBottom: 7 }}>
              {first ? (
                <SectionLabel
                  style={{ marginTop: spacing.lg }}
                  action={
                    record ? (
                      <Txt variant="mono" size={11.5}>
                        {record.w}W {record.d}D {record.l}L
                      </Txt>
                    ) : undefined
                  }
                >
                  {group.name}
                </SectionLabel>
              ) : null}
              {isDesktop ? (
                <GamesTable
                  matches={[match]}
                  uid={uid}
                  players={players}
                  onOpen={openMatch}
                  showHeader={first}
                />
              ) : (
                <SeasonMatchRow
                  match={match}
                  playerA={players.get(match.aId)!}
                  playerB={players.get(match.bId)!}
                  onPress={() => openMatch(match.id)}
                />
              )}
            </View>
          );
        }}
        ListFooterComponent={
          <View style={{ paddingVertical: spacing.lg }}>
            {pageError ? (
              <ErrorCard message="Couldn't load more games." onRetry={() => void loadMore()} />
            ) : page?.hasMore ? (
              <Button onPress={() => void loadMore()} disabled={paging}>
                {paging ? "Loading…" : "Load more games"}
              </Button>
            ) : null}
          </View>
        }
      />
    </Page>
  );
}

/** Desktop: one season's games as a table, read from `uid`'s side. */
function GamesTable({
  matches,
  uid,
  players,
  onOpen,
  showHeader = true,
}: {
  showHeader?: boolean;
  matches: LeagueMatch[];
  uid: string;
  players: Map<string, LeaguePlayer>;
  onOpen: (id: string) => void;
}) {
  return (
    <Card padded={false} style={styles.table}>
      {showHeader ? (
        <View style={[styles.tr, styles.thead]} accessibilityRole="none">
          <Txt style={[styles.th, styles.colDate]}>DATE</Txt>
          <Txt style={[styles.th, styles.colOpp]}>OPPONENT</Txt>
          <Txt style={[styles.th, styles.colTeams]}>TEAMS</Txt>
          <Txt style={[styles.th, styles.colScore, styles.center]}>SCORE</Txt>
          <Txt style={[styles.th, styles.colDelta, styles.right]}>ELO</Txt>
          <View style={styles.colChevron} />
        </View>
      ) : null}
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
