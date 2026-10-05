/**
 * Player profile — shared by the "You" tab (root) and /player/[id].
 *
 * Layout: a header band (avatar, season ELO + rank, CTAs to log a match / open the
 * head-to-head when it's someone else), then on desktop two columns — the story of their
 * season on the left (ELO chart, all-time stat cards, recent games, every pairing) and
 * their honours on the right (silverware, rivals, teams, achievements). Phones stack the
 * same sections with silverware promoted to just under the band.
 *
 * Scopes are labelled wherever they mix: the band and chart are this season, the stat
 * cards and rivals are all-time.
 */
import { type ReactNode, useCallback, useRef, useState, useMemo } from "react";
import { MIN_RANKED_GAMES } from "@/lib/league/standings";
import { type ScrollView, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import {
  AchievementBadge,
  Avatar,
  Button,
  Card,
  Columns,
  CountUp,
  EloDelta,
  EmptyState,
  ErrorCard,
  FormChips,
  Grid,
  Icon,
  IconButton,
  Interactive,
  LineChart,
  Page,
  PlayerSafetySheet,
  Reveal,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  StatCard,
  Tag,
  TeamsPlayed,
  Txt,
  type ChartPoint,
} from "@/components";
import { relativeTime, useNow } from "@/components/ActivityFeed";
import { useAuth } from "@/lib/auth";
import {
  getEloHistory,
  getHeadToHeadsForPlayer,
  getLeaguePlayers,
  getPlayerMatchPage,
  getProfileSummary,
  type ProfileSummary,
  getPlayerStats,
  getSeasonResults,
  getSeasons,
  getStandings,
  getTeams,
  canPlayAgainst,
  type HeadToHead,
  type LeagueMatch,
  type LeaguePlayer,
  type PlayerStats,
  type Season,
  type SeasonResult,
  type Standing,
  type Team,
} from "@/lib/league";
import { computeAchievements } from "@/lib/awards";
import { computeTeamRecords } from "@/lib/teamRecord";
import { computeNemesisVictim, type RivalRecord } from "@/lib/stats/rivalry";
import { confirmAction } from "@/lib/dialogs";
import { firstName, plural } from "@/lib/format";
import { logger } from "@/lib/logger";
import { useBreakpoint } from "@/lib/responsive";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { webStyle } from "@/lib/web";
import { colors, radius, spacing, resultColor } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import type { MatchResult } from "@/types";

const RECENT_PREVIEW = 6;
/** Locked achievements shown before "Show all" — the closest few to unlocking. */
const NEXT_ACHIEVEMENTS = 3;
const RANKED_AFTER_GAMES = MIN_RANKED_GAMES;
const START_ELO = 1500;

interface ProfileData {
  player: LeaguePlayer | null;
  players: Map<string, LeaguePlayer>;
  season: Season | null;
  seasons: Season[];
  seasonResults: SeasonResult[];
  standing: Standing | null;
  /** Ranked players this season — "rank 3 of 8". */
  rankedCount: number;
  stats: PlayerStats | null;
  matches: LeagueMatch[];
  summary: ProfileSummary | null;
  history: ChartPoint[];
  headToHeads: HeadToHead[];
  /** Catalogue lookup for the teams section — competition and OVR only. */
  teamsById: Map<string, Team>;
}

/** Team metadata only decorates the teams section, so a failed catalogue read must not
 *  blank the profile — the rows still render from the names stored on each match. */
async function loadTeamCatalogue(): Promise<Map<string, Team>> {
  try {
    return new Map((await getTeams()).map((team) => [team.id, team]));
  } catch (error) {
    logger.warn("profile_team_catalogue_failed", { message: String(error) });
    return new Map();
  }
}

export interface PlayerProfileScreenProps {
  uid: string;
  /** The "You" tab: no back button, edit/settings actions, sign out. */
  root?: boolean;
}

export function PlayerProfileScreen({ uid, root = false }: PlayerProfileScreenProps) {
  const router = useRouter();
  const { user, membership, signOutUser } = useAuth();
  const { isDesktop } = useBreakpoint();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useTabRetap(root ? "profile" : "", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const {
    data,
    loading,
    refreshing,
    stale,
    error: loadFailed,
    reload,
  } = useFocusData<ProfileData>(
    `player:${uid}`,
    useCallback(async (): Promise<ProfileData> => {
      // A malformed link (no id) is "not found", not a Firestore path error.
      if (!uid) {
        return {
          player: null,
          players: new Map(),
          season: null,
          seasons: [],
          seasonResults: [],
          standing: null,
          rankedCount: 0,
          stats: null,
          matches: [],
          summary: null,
          history: [],
          headToHeads: [],
          teamsById: new Map(),
        };
      }
      const summary = await getProfileSummary(uid);
      const [seasonRows, roster, allTime, pairs, playedPage, results, teamsById] =
        await Promise.all([
          getSeasons(),
          getLeaguePlayers(),
          getPlayerStats(uid),
          getHeadToHeadsForPlayer(uid),
          getPlayerMatchPage(uid, null, RECENT_PREVIEW),
          getSeasonResults(),
          loadTeamCatalogue(),
        ]);
      const activeSeason = seasonRows.find((item) => item.active) ?? null;
      const [table, eloPoints] = activeSeason
        ? await Promise.all([getStandings(activeSeason.id), getEloHistory(activeSeason.id, uid)])
        : [[], []];
      return {
        player: roster.find((item) => item.id === uid) ?? null,
        players: new Map(roster.map((item) => [item.id, item])),
        season: activeSeason,
        seasons: seasonRows,
        seasonResults: results,
        standing: table.find((item) => item.uid === uid) ?? null,
        rankedCount: table.filter((item) => item.ranked).length,
        stats: allTime,
        matches: playedPage.matches.slice().reverse(),
        summary,
        history: eloPoints.map((point) => ({
          date: point.date.toISOString().slice(0, 10),
          rating: point.rating,
        })),
        headToHeads: pairs,
        teamsById,
      };
    }, [uid]),
  );

  const isYou = uid === user?.uid;
  const player = data?.player ?? null;
  const onRefresh = () => void reload();

  const header = (
    <ScreenHeader
      title={isYou ? "Your profile" : (player?.name ?? "Player profile")}
      // A blocked player comes back without a handle (masked), so skip the line.
      subtitle={player?.handle ? `@${player.handle} · #${player.jersey}` : undefined}
      back={!root}
      onRefresh={onRefresh}
      refreshing={refreshing}
      right={
        isYou && root ? (
          <View style={styles.headerActions}>
            <IconButton
              icon="edit"
              accessibilityLabel="Edit profile"
              onPress={() => router.push("/(app)/edit-profile")}
              iconSize={17}
              color={colors.textDim}
            />
            <IconButton
              icon="settings"
              accessibilityLabel="Settings"
              onPress={() => router.push("/(app)/settings")}
              iconSize={17}
              color={colors.textDim}
            />
          </View>
        ) : !isYou && player && player.status !== "deleted" ? (
          <IconButton
            icon="shield"
            accessibilityLabel={`Report or block ${player.name}`}
            onPress={() => setSafetyOpen(true)}
            iconSize={17}
            color={colors.textDim}
          />
        ) : undefined
      }
    />
  );

  let body: ReactNode;
  if (!data) {
    body =
      loading || !loadFailed ? (
        <ProfileSkeleton desktop={isDesktop} />
      ) : (
        <ErrorCard
          message="Couldn't load this profile. Check the connection and retry."
          onRetry={onRefresh}
          retrying={refreshing || loading}
        />
      );
  } else if (!player) {
    body = (
      <EmptyState
        icon="profile"
        title="Player not found"
        body="They may have left the league, or the link is out of date."
        action={{
          label: "Back to the table",
          icon: "board",
          onPress: () => router.navigate("/(app)/(tabs)/leaderboard"),
        }}
      />
    );
  } else {
    body = (
      <View style={stale ? { opacity: 0.5 } : undefined}>
        {loadFailed ? (
          <ErrorCard
            message="Couldn't refresh — showing the last loaded profile."
            onRetry={onRefresh}
            retrying={refreshing}
            style={{ marginBottom: spacing.lg }}
          />
        ) : null}
        <ProfileBody
          uid={uid}
          me={user?.uid}
          isYou={isYou}
          data={data}
          player={player}
          onSignOut={
            isYou && root
              ? () =>
                  confirmAction({
                    title: "Sign out?",
                    message: "You can sign back in any time — your record stays on the table.",
                    confirmLabel: "Sign out",
                    destructive: true,
                    onConfirm: () => void signOutUser(),
                  })
              : undefined
          }
        />
      </View>
    );
  }

  return (
    <Page
      header={header}
      edges={root ? ["top"] : ["top", "bottom"]}
      width="wide"
      scrollRef={scrollRef}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {body}
      {player && !isYou ? (
        <PlayerSafetySheet
          player={player}
          visible={safetyOpen}
          isAdmin={membership?.role === "admin"}
          onClose={() => setSafetyOpen(false)}
          onChanged={onRefresh}
        />
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------

function ProfileBody({
  uid,
  me,
  isYou,
  data,
  player,
  onSignOut,
}: {
  uid: string;
  me: string | undefined;
  isYou: boolean;
  data: ProfileData;
  player: LeaguePlayer;
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const { isDesktop, isTablet } = useBreakpoint();
  const [allAchievements, setAllAchievements] = useState(false);
  const now = useNow();
  const { players, season, seasons, seasonResults, standing, stats, matches, history } = data;

  const isReigningChampion = seasonResults.length > 0 && uid === seasonResults[0].championId;
  const seasonsById = new Map(seasons.map((item) => [item.id, item]));
  // Honours: Champion (table-topper historically; Grand Final winner for finals-format
  // seasons), Premier (finals-format table-topper), or The Double for both in one season.
  const titles = seasonResults.flatMap((result) => {
    const champion = result.championId === uid;
    const premier = result.format === "finals" && result.premierId === uid;
    const kind =
      champion && premier ? "double" : champion ? "champion" : premier ? "premier" : null;
    return kind ? [{ seasonId: result.seasonId, kind }] : [];
  });
  const teamRecords = useMemo(
    () => data.summary?.teamRecords ?? computeTeamRecords(uid, matches, data.teamsById),
    [data.summary, uid, matches, data.teamsById],
  );
  const achievements = useMemo(
    () => computeAchievements(uid, stats, matches, data.summary?.facts),
    [uid, stats, matches, data.summary?.facts],
  );
  const unlocked = achievements.filter((a) => a.unlocked);
  const nextUp = achievements
    .filter((a) => !a.unlocked)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, NEXT_ACHIEVEMENTS);
  const shownAchievements = allAchievements ? achievements : [...unlocked, ...nextUp];
  const recentMatches = matches.slice().reverse();
  const previewMatches = recentMatches.slice(0, RECENT_PREVIEW);
  // One nemesis rule everywhere: worst points share over 3+ meetings (the server's rule).
  const { nemesis, victim } = computeNemesisVictim(uid, data.headToHeads);
  const h2hRows = data.headToHeads
    .map((pair) => {
      const asA = pair.aId === uid;
      return {
        pair,
        opponentId: asA ? pair.bId : pair.aId,
        wins: asA ? pair.aWins : pair.bWins,
        losses: asA ? pair.bWins : pair.aWins,
        draws: pair.draws,
      };
    })
    .sort((a, b) => b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws));
  const seasonDelta =
    history.length >= 2 ? history[history.length - 1].rating - history[0].rating : 0;
  const hotStreak = stats?.currentStreakType === "W" && (stats.currentStreak ?? 0) >= 3;

  const openH2H = (opponentId: string) =>
    router.push({ pathname: "/(app)/h2h", params: { a: uid, b: opponentId } } as Href);
  const openMatch = (matchId: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id: matchId } } as Href);

  // ---- Sections ----------------------------------------------------------------------

  const band = (
    <HeaderBand
      player={player}
      season={season}
      standing={standing}
      rankedCount={data.rankedCount}
      stats={stats}
      champion={isReigningChampion}
      titles={titles.length}
      actions={
        !isYou ? (
          <>
            {season && season.phase === "regular" && canPlayAgainst(player) ? (
              <Button
                icon="plus"
                size={isTablet ? "md" : "sm"}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/log-match",
                    params: { opponent: uid },
                  } as Href)
                }
                style={!isTablet ? { flex: 1 } : undefined}
              >
                {/* Phones already show the name in the header right above. */}
                {isTablet ? `Log match vs ${firstName(player.name)}` : "Log match"}
              </Button>
            ) : null}
            {me ? (
              <Button
                variant="dark"
                icon="swords"
                size={isTablet ? "md" : "sm"}
                onPress={() =>
                  router.push({ pathname: "/(app)/h2h", params: { a: me, b: uid } } as Href)
                }
                style={!isTablet ? { flex: 1 } : undefined}
              >
                Head-to-head
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  );

  const chart = (
    <Card style={styles.chartCard}>
      <View style={styles.cardHeading}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
            {season ? `ELO · ${season.name.toUpperCase()}` : "ELO OVER TIME"}
          </Txt>
        </View>
        {history.length >= 2 ? <EloDelta delta={seasonDelta} size={12} /> : null}
        <Txt variant="mono" size={11} color={colors.textDim}>
          {plural(Math.max(0, history.length - 1), "game")}
        </Txt>
      </View>
      {history.length >= 2 ? (
        <View style={{ marginTop: spacing.sm }}>
          <LineChart data={history} height={isDesktop ? 220 : 160} />
        </View>
      ) : (
        <View style={styles.chartEmpty}>
          <Icon name="trend" size={22} color={colors.textFaint} />
          <Txt size={12.5} color={colors.textDim} style={{ textAlign: "center" }}>
            {season
              ? "Two confirmed matches this season draw the rating line."
              : "The rating line starts with the next season."}
          </Txt>
        </View>
      )}
    </Card>
  );

  const statCards = (
    <View>
      <SectionLabel>All-time</SectionLabel>
      <Grid min={150} maxColumns={4} gap={spacing.sm}>
        <StatCard
          label="Record"
          value={`${stats?.w ?? 0}-${stats?.d ?? 0}-${stats?.l ?? 0}`}
          sub={plural(stats?.games ?? 0, "game")}
        />
        <StatCard
          label="Win rate"
          value={stats?.winRate ?? 0}
          suffix="%"
          countUp
          sub={`${stats?.gf ?? 0} for · ${stats?.ga ?? 0} against`}
          accent
        />
        <StatCard
          label="Current run"
          value={stats?.currentStreak ?? 0}
          countUp
          sub={streakLabel(stats)}
          accent={stats?.currentStreakType === "W"}
          icon={hotStreak ? "flame" : undefined}
          iconColor={colors.gold}
        />
        <StatCard
          label="Best streak"
          value={stats?.longestWin ?? 0}
          countUp
          sub={`${stats?.longestUnbeaten ?? 0} unbeaten`}
        />
      </Grid>
    </View>
  );

  const formAndBiggest = (
    <Grid min={220} maxColumns={2} gap={spacing.sm}>
      <Card style={styles.splitCard}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
          LAST 5 · THIS SEASON
        </Txt>
        <View style={{ marginTop: spacing.sm }}>
          <FormChips results={standing?.form ?? []} size={24} />
        </View>
      </Card>
      <Card style={styles.splitCard}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
          BIGGEST WIN · ALL-TIME
        </Txt>
        {stats?.biggestWin ? (
          <>
            <Txt variant="monoBold" size={22} style={{ marginTop: 5 }}>
              {stats.biggestWin.goalsFor}–{stats.biggestWin.goalsAgainst}
            </Txt>
            <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
              vs {players.get(stats.biggestWin.opponentId)?.name ?? "Opponent"}
            </Txt>
          </>
        ) : (
          <Txt size={12} color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            No wins yet
          </Txt>
        )}
      </Card>
    </Grid>
  );

  const recent = (
    <View>
      <SectionLabel
        action={
          (data.summary?.matchCount ?? matches.length) > RECENT_PREVIEW ? (
            <TextLink
              label="SEE ALL"
              onPress={() => router.push({ pathname: "/(app)/games", params: { uid } } as Href)}
            />
          ) : matches.length ? (
            <Txt variant="monoBold" size={11} color={colors.textDim}>
              {data.summary?.matchCount ?? matches.length} played
            </Txt>
          ) : undefined
        }
      >
        Recent games
      </SectionLabel>
      {previewMatches.length ? (
        <View style={styles.listCard}>
          {previewMatches.map((match, index) => (
            <RecentGameRow
              key={match.id}
              uid={uid}
              match={match}
              opponent={players.get(match.aId === uid ? match.bId : match.aId)}
              divider={index > 0}
              now={now}
              onPress={() => openMatch(match.id)}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          compact
          icon="ball"
          title="No confirmed games yet"
          body={
            isYou
              ? "Log a match — once your opponent confirms, it lands here."
              : `${firstName(player.name)}'s confirmed results will show up here.`
          }
        />
      )}
    </View>
  );

  const silverware =
    titles.length > 0 ? (
      <View>
        <SectionLabel
          action={
            <Txt variant="monoBold" size={11.5} color={colors.gold}>
              {plural(titles.length, "title")}
            </Txt>
          }
        >
          Silverware
        </SectionLabel>
        <View style={{ gap: spacing.sm }}>
          {titles.map((title, index) => {
            const titleSeason = seasonsById.get(title.seasonId);
            const label =
              title.kind === "double"
                ? "The Double"
                : title.kind === "premier"
                  ? "Premier"
                  : "Champion";
            const sub =
              title.kind === "double"
                ? "Premier + Champion"
                : title.kind === "premier"
                  ? "Top of the table"
                  : "League title";
            const reigning =
              isReigningChampion &&
              title.kind !== "premier" &&
              title.seasonId === seasonResults[0]?.seasonId;
            return (
              <Reveal key={`${title.seasonId}-${title.kind}`} from="left" index={index}>
                <View style={[styles.titleRow, reigning && styles.titleRowReigning]}>
                  <View style={styles.trophyTile}>
                    <Icon
                      name={
                        title.kind === "double"
                          ? "crown"
                          : title.kind === "premier"
                            ? "medal"
                            : "trophy"
                      }
                      size={18}
                      color={colors.gold}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                      {titleSeason?.name ?? "Season"} {label}
                    </Txt>
                    <Txt variant="mono" size={10.5} color={colors.textDim}>
                      {titleSeason ? `${titleSeason.year} · ` : ""}
                      {sub}
                    </Txt>
                  </View>
                  {reigning ? <Tag tone="gold">REIGNING</Tag> : null}
                </View>
              </Reveal>
            );
          })}
        </View>
      </View>
    ) : null;

  const rivals = (
    <RivalsCard nemesis={nemesis} victim={victim} players={players} onOpen={openH2H} />
  );

  const teams = (
    <View>
      <SectionLabel
        action={
          teamRecords.teams.length ? (
            <Txt variant="monoBold" size={11.5} color={colors.textDim}>
              {plural(teamRecords.teams.length, "team")}
            </Txt>
          ) : undefined
        }
      >
        Teams played
      </SectionLabel>
      <TeamsPlayed summary={teamRecords} />
    </View>
  );

  const achievementsSection = (
    <View>
      <SectionLabel
        action={
          <Txt variant="monoBold" size={11.5} color={colors.textDim}>
            {unlocked.length}/{achievements.length} unlocked
          </Txt>
        }
      >
        Achievements
      </SectionLabel>
      <Grid min={150} maxColumns={2} gap={spacing.sm}>
        {shownAchievements.map((achievement, index) => (
          <AchievementBadge key={achievement.key} achievement={achievement} index={index} />
        ))}
      </Grid>
      {achievements.length > shownAchievements.length || allAchievements ? (
        <Interactive
          onPress={() => setAllAchievements((value) => !value)}
          accessibilityState={{ expanded: allAchievements }}
          style={styles.more}
          hoverStyle={{ backgroundColor: colors.surface }}
        >
          <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
            {allAchievements ? "SHOW FEWER" : `SHOW ALL ${achievements.length} ACHIEVEMENTS`}
          </Txt>
        </Interactive>
      ) : null}
    </View>
  );

  const h2h = (
    <View>
      <SectionLabel>Head-to-head · all-time</SectionLabel>
      {h2hRows.length ? (
        <View style={styles.listCard}>
          {h2hRows.map((row, index) => {
            const opponent = players.get(row.opponentId);
            if (!opponent) return null;
            const games = row.wins + row.draws + row.losses;
            const isNemesis = nemesis?.opponentId === row.opponentId && nemesis.sharePercent < 50;
            return (
              <Interactive
                key={row.pair.pairKey}
                onPress={() => openH2H(opponent.id)}
                accessibilityRole="link"
                accessibilityLabel={`${opponent.name}: ${row.wins} wins, ${row.draws} draws, ${row.losses} losses. Open head-to-head`}
                pressScale={1}
                style={[styles.h2hRow, index > 0 && styles.divider]}
                hoverStyle={{ backgroundColor: colors.surface2 }}
              >
                <Avatar player={opponent} size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                    {opponent.name}
                  </Txt>
                  <Txt variant="mono" size={10.5} color={colors.textDim}>
                    {plural(games, "meeting")}
                    {row.draws ? ` · ${plural(row.draws, "draw")}` : ""}
                  </Txt>
                </View>
                {isNemesis ? <Tag tone="loss">NEMESIS</Tag> : null}
                <WinLoss wins={row.wins} losses={row.losses} />
                <Icon name="chevron" size={15} color={colors.textFaint} />
              </Interactive>
            );
          })}
        </View>
      ) : (
        <EmptyState
          compact
          icon="swords"
          title="No confirmed matchups yet"
          body="Every opponent faced shows up here with the running score."
        />
      )}
    </View>
  );

  const signOut = onSignOut ? (
    <Button variant="ghost" icon="logout" onPress={onSignOut} style={styles.signOut}>
      Sign out
    </Button>
  ) : null;

  const reveal = (node: ReactNode, index: number) =>
    node ? (
      <Reveal key={index} index={index}>
        {node}
      </Reveal>
    ) : null;

  if (isDesktop) {
    return (
      <View style={styles.stack}>
        {reveal(band, 0)}
        <Columns ratio={[2, 1]} gap={spacing.x3}>
          <View style={styles.stack}>
            {reveal(chart, 1)}
            {reveal(statCards, 2)}
            {reveal(formAndBiggest, 3)}
            {reveal(recent, 4)}
            {reveal(h2h, 5)}
          </View>
          <View style={styles.stack}>
            {reveal(silverware, 2)}
            {reveal(rivals, 3)}
            {reveal(teams, 4)}
            {reveal(achievementsSection, 5)}
            {signOut}
          </View>
        </Columns>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      {reveal(band, 0)}
      {reveal(silverware, 1)}
      {reveal(chart, 2)}
      {reveal(statCards, 3)}
      {reveal(formAndBiggest, 4)}
      {reveal(recent, 5)}
      {reveal(rivals, 6)}
      {reveal(teams, 7)}
      {reveal(achievementsSection, 8)}
      {reveal(h2h, 9)}
      {signOut}
    </View>
  );
}

// ---------------------------------------------------------------------------------------

function HeaderBand({
  player,
  season,
  standing,
  rankedCount,
  stats,
  champion,
  titles,
  actions,
}: {
  player: LeaguePlayer;
  season: Season | null;
  standing: Standing | null;
  rankedCount: number;
  stats: PlayerStats | null;
  champion: boolean;
  titles: number;
  actions: ReactNode;
}) {
  const { isTablet, isDesktop } = useBreakpoint();
  const games = standing ? standing.w + standing.d + standing.l : 0;
  const status = !season
    ? "BETWEEN SEASONS"
    : standing?.ranked
      ? `RANK #${standing.rank} OF ${rankedCount}`
      : standing
        ? `PLACEMENT · ${games}/${RANKED_AFTER_GAMES} GAMES`
        : "NOT PLAYED THIS SEASON";
  const avatarSize = isDesktop ? 84 : 66;

  return (
    <View style={[styles.band, champion && styles.bandChampion]}>
      <View style={[styles.bandMain, !isTablet && { alignItems: "flex-start" }]}>
        <View
          style={[
            { borderRadius: avatarSize / 2 },
            champion &&
              webStyle({
                boxShadow: "0 0 0 6px rgba(255,210,74,0.10), 0 0 32px rgba(255,210,74,0.35)",
              }),
          ]}
        >
          <Avatar player={player} size={avatarSize} ring jersey champion={champion} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.bandTags}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
              {season ? `ELO · ${season.name.toUpperCase()}` : "ELO"}
            </Txt>
            {champion ? <Tag tone="gold">REIGNING CHAMPION</Tag> : null}
            {!champion && titles > 0 ? <Tag tone="gold">{plural(titles, "TITLE")}</Tag> : null}
          </View>
          {season ? (
            <CountUp
              value={standing?.elo ?? START_ELO}
              from={START_ELO}
              duration={1100}
              variant="monoBold"
              size={isDesktop ? 50 : 42}
              color={colors.accent}
              style={styles.elo}
            />
          ) : (
            <Txt
              variant="monoBold"
              size={isDesktop ? 50 : 42}
              color={colors.textFaint}
              style={styles.elo}
            >
              —
            </Txt>
          )}
          <View style={styles.statusRow}>
            <Txt variant="mono" size={12} color={colors.textDim}>
              {status}
            </Txt>
            {standing?.ranked && standing.move ? (
              <Txt
                variant="monoBold"
                size={12}
                color={standing.move > 0 ? colors.win : colors.loss}
              >
                {standing.move > 0 ? "▲" : "▼"}
                {Math.abs(standing.move)}
              </Txt>
            ) : null}
          </View>
          {standing && !standing.ranked ? (
            <View style={styles.placementTrack}>
              <View
                style={[
                  styles.placementFill,
                  { width: `${Math.min(100, (games / RANKED_AFTER_GAMES) * 100)}%` },
                ]}
              />
            </View>
          ) : null}
        </View>
        {isTablet ? (
          <View style={styles.bandSide}>
            {standing ? (
              <View style={styles.bandRecord}>
                <MiniStat
                  value={`${standing.w}-${standing.d}-${standing.l}`}
                  label="SEASON W-D-L"
                />
                <MiniStat value={`${stats?.winRate ?? 0}%`} label="ALL-TIME WIN %" />
              </View>
            ) : stats && stats.games ? (
              <View style={styles.bandRecord}>
                <MiniStat value={`${stats.w}-${stats.d}-${stats.l}`} label="ALL-TIME W-D-L" />
              </View>
            ) : null}
            {actions ? <View style={styles.bandActions}>{actions}</View> : null}
          </View>
        ) : null}
      </View>
      {!isTablet && actions ? <View style={styles.bandActionsPhone}>{actions}</View> : null}
    </View>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Txt variant="monoBold" size={18}>
        {value}
      </Txt>
      <Txt variant="head" size={9} color={colors.textFaint} style={{ letterSpacing: 1 }}>
        {label}
      </Txt>
    </View>
  );
}

function WinLoss({ wins, losses, size = 17 }: { wins: number; losses: number; size?: number }) {
  return (
    <Txt variant="monoBold" size={size}>
      <Txt
        variant="monoBold"
        size={size}
        color={wins > losses ? colors.win : wins < losses ? colors.loss : colors.text}
      >
        {wins}
      </Txt>
      <Txt variant="monoBold" size={size} color={colors.textFaint}>
        {" – "}
      </Txt>
      {losses}
    </Txt>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      pressScale={1}
      style={styles.textLink}
      hoverStyle={{ backgroundColor: colors.surface }}
    >
      <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
        {label}
      </Txt>
      <Icon name="chevron" size={12} color={colors.accent} />
    </Interactive>
  );
}

/** One of this player's games, told from their side: result, opponent, score, ELO swing. */
function RecentGameRow({
  uid,
  match,
  opponent,
  divider,
  now,
  onPress,
}: {
  uid: string;
  match: LeagueMatch;
  opponent: LeaguePlayer | undefined;
  divider: boolean;
  /** Shared clock from the list so relative dates re-tick together. */
  now: number;
  onPress: () => void;
}) {
  const asA = match.aId === uid;
  const mine = asA ? match.aGoals : match.bGoals;
  const theirs = asA ? match.bGoals : match.aGoals;
  const result: MatchResult = mine > theirs ? "W" : mine < theirs ? "L" : "D";
  const delta = asA ? match.aDelta : match.bDelta;
  const myTeam = asA ? match.aTeam : match.bTeam;
  const theirTeam = asA ? match.bTeam : match.aTeam;
  const name = opponent?.name ?? "Former player";
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${result === "W" ? "Won" : result === "L" ? "Lost" : "Drew"} ${mine}–${theirs} against ${name}. Open match`}
      pressScale={1}
      style={[styles.gameRow, divider && styles.divider]}
      hoverStyle={{ backgroundColor: colors.surface2 }}
    >
      <View style={[styles.resultChip, { backgroundColor: resultColor[result] }]}>
        <Txt variant="monoBold" size={11} color={colors.onAccent}>
          {result}
        </Txt>
      </View>
      <Avatar player={opponent} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
          vs {name}
        </Txt>
        <Txt variant="mono" size={10.5} color={colors.textDim} numberOfLines={1}>
          {myTeam} v {theirTeam}
          {match.date ? ` · ${relativeTime(match.date, now)}` : ""}
        </Txt>
      </View>
      <View style={{ alignItems: "flex-end", gap: 1 }}>
        <Txt variant="monoBold" size={16}>
          {mine}–{theirs}
        </Txt>
        {delta != null ? <EloDelta delta={delta} size={11} /> : null}
      </View>
    </Interactive>
  );
}

type RivalKind = "nemesis" | "victim" | "rival";

/** Worst and best all-time records (3+ meetings), each opening a prefilled head-to-head. */
function RivalsCard({
  nemesis,
  victim,
  players,
  onOpen,
}: {
  nemesis: RivalRecord | null;
  victim: RivalRecord | null;
  players: Map<string, LeaguePlayer>;
  onOpen: (opponentId: string) => void;
}) {
  // One qualifying opponent is both their best and worst matchup — collapse to a single row
  // instead of naming the same person twice.
  const solo = nemesis && victim && nemesis.opponentId === victim.opponentId;
  const entries: Array<{ kind: RivalKind; record: RivalRecord }> = [];
  if (nemesis && !solo) entries.push({ kind: "nemesis", record: nemesis });
  if (victim) entries.push({ kind: solo ? "rival" : "victim", record: victim });
  if (entries.length === 0) return null;

  return (
    <View>
      <SectionLabel>Rivals · all-time</SectionLabel>
      <View style={{ gap: spacing.sm }}>
        {entries.map(({ kind, record }) => {
          const opponent = players.get(record.opponentId);
          if (!opponent) return null;
          const tone =
            kind === "nemesis" ? colors.loss : kind === "victim" ? colors.win : colors.gold;
          return (
            <Interactive
              key={kind}
              onPress={() => onOpen(record.opponentId)}
              accessibilityRole="link"
              accessibilityLabel={`${kind}: ${opponent.name}, ${record.wins} wins ${record.losses} losses. Open head-to-head`}
              lift
              pressScale={0.99}
              style={[
                styles.rivalRow,
                {
                  borderColor: withAlpha(tone, 0.25),
                  backgroundColor: mix(colors.surface, tone, 4),
                },
              ]}
              hoverStyle={{ borderColor: withAlpha(tone, 0.5) }}
            >
              <Avatar player={opponent} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rivalName}>
                  <Txt variant="bodyMedium" size={13.5} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {opponent.name}
                  </Txt>
                  <Tag tone={kind === "nemesis" ? "loss" : kind === "victim" ? "accent" : "gold"}>
                    {kind.toUpperCase()}
                  </Tag>
                </View>
                <Txt variant="mono" size={10.5} color={colors.textDim}>
                  {record.sharePercent}% of points · {plural(record.games, "game")}
                </Txt>
              </View>
              <WinLoss wins={record.wins} losses={record.losses} size={18} />
            </Interactive>
          );
        })}
      </View>
    </View>
  );
}

function ProfileSkeleton({ desktop }: { desktop: boolean }) {
  const band = (
    <View style={[styles.band, { flexDirection: "row", alignItems: "center", gap: spacing.lg }]}>
      <Skeleton width={desktop ? 84 : 66} height={desktop ? 84 : 66} round={42} />
      <View style={{ flex: 1, gap: 10 }}>
        <Skeleton width="30%" height={10} />
        <Skeleton width={140} height={desktop ? 44 : 36} />
        <Skeleton width="40%" height={10} />
      </View>
    </View>
  );
  const left = (
    <View style={styles.stack}>
      <SkeletonCard height={desktop ? 280 : 210} />
      <Grid min={150} maxColumns={4} gap={spacing.sm}>
        <SkeletonCard height={96} />
        <SkeletonCard height={96} />
        <SkeletonCard height={96} />
        <SkeletonCard height={96} />
      </Grid>
      <SkeletonRows count={3} />
    </View>
  );
  return (
    <View style={styles.stack} accessibilityLabel="Loading profile">
      {band}
      {desktop ? (
        <Columns ratio={[2, 1]} gap={spacing.x3}>
          {left}
          <View style={styles.stack}>
            <SkeletonRows count={2} />
            <SkeletonCard height={180} />
          </View>
        </Columns>
      ) : (
        left
      )}
    </View>
  );
}

function streakLabel(stats: PlayerStats | null): string {
  if (!stats?.currentStreakType) return "no active run";
  if (stats.currentStreakType === "W") return "win streak";
  if (stats.currentStreakType === "L") return "losses in a row";
  return "drawn run";
}

const styles = StyleSheet.create({
  stack: { gap: spacing.x2 },
  kicker: { letterSpacing: 1.2 },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  band: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.18),
    backgroundColor: mix(colors.surface, colors.accent, 5),
  },
  bandChampion: {
    borderColor: withAlpha(colors.gold, 0.35),
    backgroundColor: mix(colors.surface, colors.gold, 5),
  },
  bandMain: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  bandTags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  bandSide: { alignItems: "flex-end", gap: spacing.md },
  bandRecord: { flexDirection: "row", gap: spacing.x2 },
  bandActions: { flexDirection: "row", gap: spacing.sm },
  bandActionsPhone: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  elo: { letterSpacing: -1.2, marginTop: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  placementTrack: {
    height: 4,
    width: 140,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  placementFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent },
  chartCard: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: 2,
  },
  chartEmpty: {
    height: 130,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  splitCard: { minHeight: 102, flexGrow: 1 },
  listCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  gameRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  resultChip: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  h2hRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rivalRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  rivalName: { flexDirection: "row", alignItems: "center", gap: 6 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.18),
    borderRadius: radius.md,
    backgroundColor: mix(colors.surface, colors.gold, 3),
  },
  titleRowReigning: { borderColor: withAlpha(colors.gold, 0.45) },
  trophyTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.35),
    backgroundColor: withAlpha(colors.gold, 0.1),
  },
  textLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: -6,
    borderRadius: radius.sm,
  },
  more: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
  signOut: { alignSelf: "stretch" },
});
