/**
 * Home tab — the lunchtime dashboard. In priority order it answers: is anything waiting
 * on me (results to confirm, my results waiting on others), where do I stand (ELO hero +
 * a "your position" slice of the table), and who should I play next. Desktop splits into
 * two columns (me / the league); phones stack the same sections in reading order.
 */
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { type ScrollView, StyleSheet, View } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import { type Href, useRouter } from "expo-router";
import {
  ActivityFeed,
  Avatar,
  Button,
  Card,
  Columns,
  CountUp,
  ErrorCard,
  Icon,
  IconButton,
  Interactive,
  Page,
  RefreshButton,
  Reveal,
  SectionLabel,
  SkeletonCard,
  SkeletonRows,
  Tag,
  Txt,
} from "@/components";
import {
  InboxSection,
  PlayNextCard,
  PositionTable,
  RANKED_AFTER_GAMES,
  START_ELO,
  logMatchHref,
  suggestOpponents,
} from "@/screens/HomeSections";
import { useAuth } from "@/lib/auth";
import {
  getActiveSeason,
  getCup,
  getHeadToHeadsForPlayer,
  getLeaguePlayers,
  getPlayerStats,
  getRecentActivity,
  getStandings,
  type ActivityEvent,
  type CupState,
  type HeadToHead,
  type LeaguePlayer,
  type PlayerStats,
  type Season,
  type Standing,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { useTabRetap } from "@/lib/tabRetap";
import { useBreakpoint } from "@/lib/responsive";
import { useDocumentTitle } from "@/lib/web";
import { usePendingCount } from "@/lib/pendingCount";
import { plural } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

interface HomeData {
  season: Season | null;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  playerStats: PlayerStats | null;
  activity: ActivityEvent[];
  cup: CupState | null;
  /** My pairings — Play next uses them to find opponents not yet faced this season. */
  headToHeads: HeadToHead[];
}

const SECTION_GAP = spacing.x2;

export default function Home() {
  const router = useRouter();
  const { user, profile, membership } = useAuth();
  const { isDesktop, isTablet } = useBreakpoint();
  const isAdmin = membership?.role === "admin";
  const uid = user?.uid;
  const pendingCount = usePendingCount();
  // Bumping this remounts the inbox section, which resubscribes its live listener.
  const [inboxKey, setInboxKey] = useState(0);
  useDocumentTitle("Home");

  const {
    data,
    loading,
    refreshing,
    error: loadFailed,
    reload,
  } = useFocusData<HomeData>(
    `home:${uid ?? "anon"}`,
    useCallback(async () => {
      if (!uid) {
        return {
          season: null,
          standings: [],
          players: new Map<string, LeaguePlayer>(),
          playerStats: null,
          activity: [],
          cup: null,
          headToHeads: [],
        };
      }
      const activeSeason = await getActiveSeason();
      const [roster, table, allTime, feed, cup, pairs] = await Promise.all([
        getLeaguePlayers(),
        activeSeason ? getStandings(activeSeason.id) : Promise.resolve([]),
        getPlayerStats(uid),
        getRecentActivity(20),
        activeSeason ? getCup(activeSeason.id) : Promise.resolve(null),
        // Decorative (Play next only) — a failed read must not blank the dashboard.
        getHeadToHeadsForPlayer(uid).catch(() => [] as HeadToHead[]),
      ]);
      return {
        season: activeSeason,
        standings: table,
        players: new Map(roster.map((player) => [player.id, player])),
        playerStats: allTime,
        activity: feed,
        cup,
        headToHeads: pairs,
      };
    }, [isAdmin, uid]),
  );

  const scrollRef = useRef<ScrollView>(null);
  useTabRetap("home", () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const season = data?.season ?? null;
  const standings = useMemo(() => data?.standings ?? [], [data]);
  const players = useMemo(() => data?.players ?? new Map<string, LeaguePlayer>(), [data]);
  const playerStats = data?.playerStats ?? null;
  const myStanding = standings.find((row) => row.uid === uid) ?? null;

  const suggestions = useMemo(
    () =>
      data && uid && data.season && data.season.phase === "regular"
        ? suggestOpponents({
            uid,
            season: data.season,
            standings: data.standings,
            players: data.players,
            headToHeads: data.headToHeads,
            cup: data.cup,
          })
        : [],
    [data, uid],
  );

  const openProfile = () => router.navigate("/(app)/(tabs)/profile");
  const openPlayer = (id: string) => router.push(`/(app)/player/${id}` as Href);
  const openTable = () => router.navigate("/(app)/(tabs)/leaderboard");
  const logMatch = () => router.push("/(app)/log-match");

  // Nemesis: the server's pick (worst points share, 3+ meetings — the same rule as the
  // profile's Rivals card), shown only while they actually have the upper hand.
  const nemesisRecord = playerStats?.nemesis ?? null;
  const nemesis = nemesisRecord ? players.get(nemesisRecord.opponentId) : undefined;
  const nemesisShare = nemesisRecord?.games
    ? (nemesisRecord.wins + nemesisRecord.draws * 0.5) / nemesisRecord.games
    : 1;

  // ---- Sections ------------------------------------------------------------------------

  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt
          variant="head"
          size={10.5}
          color={colors.textDim}
          numberOfLines={1}
          style={{ letterSpacing: 1.6 }}
        >
          {season
            ? isTablet
              ? `OFFICEFC · ${season.name.toUpperCase()}`
              : season.name.toUpperCase()
            : "OFFICEFC"}
        </Txt>
        <Txt
          variant="head"
          size={isDesktop ? 30 : 24}
          numberOfLines={1}
          accessibilityRole="header"
          style={{ marginTop: 2, letterSpacing: isDesktop ? -0.4 : 0 }}
        >
          Hey, {profile?.displayName?.split(" ")[0] ?? "player"}
        </Txt>
      </View>
      {isAdmin ? (
        isTablet ? (
          <Button
            size="sm"
            variant="dark"
            icon="shield"
            onPress={() => router.push("/(app)/admin")}
          >
            Admin
          </Button>
        ) : (
          <IconButton
            icon="shield"
            accessibilityLabel="Admin dashboard"
            onPress={() => router.push("/(app)/admin")}
            iconSize={17}
            color={colors.textDim}
          />
        )
      ) : null}
      {/* Phones have no Inbox tab (the side rail has one from tablet up), so the inbox
          stays one tap away here even when nothing is pending. */}
      {!isTablet ? (
        <IconButton
          icon="inbox"
          accessibilityLabel={pendingCount ? `Inbox, ${pendingCount} waiting` : "Inbox"}
          onPress={() => router.push("/(app)/confirmations")}
          iconSize={18}
          color={pendingCount ? colors.accent : colors.textDim}
        >
          {pendingCount ? (
            <View style={styles.headerBadge}>
              <Txt variant="monoBold" size={9} color={colors.onAccent}>
                {pendingCount}
              </Txt>
            </View>
          ) : null}
        </IconButton>
      ) : null}
      <RefreshButton onPress={() => void reload()} refreshing={refreshing} />
    </View>
  );

  const banners = (
    <>
      {season?.phase === "finals" ? (
        <Banner
          icon="trophy"
          title="Finals are live"
          body="The table is locked — the bracket decides the champion."
          onPress={() => router.push("/(app)/finals")}
        />
      ) : null}
      {data?.cup?.status === "live" ? (
        <Banner
          icon="swords"
          title="Cup is running"
          body="The knockout bracket runs alongside the league — your tie could be next."
          onPress={() => router.push("/(app)/cup")}
        />
      ) : null}
    </>
  );

  // Nothing to show yet and no failure: skeletons. (`loading` alone isn't enough — it's
  // false for the instant before the first fetch starts, which flashed the error card.)
  const firstLoad = !data && !loadFailed;

  let hero: ReactNode;
  if (firstLoad) {
    hero = <SkeletonCard height={isDesktop ? 196 : 176} />;
  } else if (!data) {
    // First load failed: no hero at all — never fake numbers (1500 / UNRANKED / 0 days).
    hero = (
      <ErrorCard
        message="Couldn't load the live league data. Check the connection and retry."
        onRetry={() => void reload()}
        retrying={refreshing || loading}
      />
    );
  } else if (!season) {
    hero = (
      <BetweenSeasons
        stats={playerStats}
        isAdmin={isAdmin}
        onAdmin={() => router.push("/(app)/admin")}
        onHistory={() => router.navigate("/(app)/(tabs)/seasons")}
      />
    );
  } else {
    hero = (
      <SeasonHero
        season={season}
        standing={myStanding}
        rankedCount={standings.filter((s) => s.ranked).length}
        stats={playerStats}
        onPress={openProfile}
      />
    );
  }

  const inbox = uid ? (
    <InboxSection
      key={inboxKey}
      uid={uid}
      players={players}
      onRetry={() => setInboxKey((k) => k + 1)}
      style={{ marginTop: spacing.lg }}
    />
  ) : null;

  const placementLeft =
    myStanding && !myStanding.ranked
      ? Math.max(1, RANKED_AFTER_GAMES - (myStanding.w + myStanding.d + myStanding.l))
      : !myStanding
        ? RANKED_AFTER_GAMES
        : 0;

  const playNext =
    suggestions.length > 0 ? (
      <PlayNextCard
        suggestions={suggestions}
        placementLeft={placementLeft}
        onPlay={(id) => router.push(logMatchHref(id))}
      />
    ) : null;

  const nemesisCard =
    nemesis && nemesisRecord && nemesisShare < 0.5 ? (
      <View>
        <SectionLabel>Current nemesis</SectionLabel>
        <Interactive
          onPress={() =>
            router.push({ pathname: "/(app)/h2h", params: { a: uid ?? "", b: nemesis.id } })
          }
          accessibilityRole="link"
          accessibilityLabel={`Your nemesis ${nemesis.name}: ${nemesisRecord.wins} wins, ${nemesisRecord.draws} draws, ${nemesisRecord.losses} losses all-time. Open head-to-head`}
          lift
          pressScale={0.99}
          style={styles.nemesisCard}
          hoverStyle={{ borderColor: withAlpha(colors.loss, 0.45) }}
        >
          <Avatar player={nemesis} size={48} jersey />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyMedium" size={14.5} numberOfLines={1}>
              {nemesis.name}
            </Txt>
            <Txt size={11.5} color={colors.textDim}>
              Worst matchup · {plural(nemesisRecord.games, "meeting")}
            </Txt>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="monoBold" size={24}>
              {nemesisRecord.wins}
              <Txt variant="monoBold" size={22} color={colors.textFaint}>
                {" – "}
              </Txt>
              <Txt variant="monoBold" size={24} color={colors.loss}>
                {nemesisRecord.losses}
              </Txt>
            </Txt>
            <Txt variant="head" size={8.5} color={colors.textDim} style={{ letterSpacing: 1 }}>
              W – L · ALL-TIME
            </Txt>
          </View>
          <Icon name="chevron" size={15} color={colors.textFaint} />
        </Interactive>
      </View>
    ) : null;

  const position = firstLoad ? (
    <View>
      <SectionLabel>Your position</SectionLabel>
      <SkeletonRows count={4} height={52} />
    </View>
  ) : data && season && uid ? (
    <PositionTable
      uid={uid}
      standings={standings}
      players={players}
      onOpenPlayer={openPlayer}
      onOpenTable={openTable}
      onLogMatch={logMatch}
    />
  ) : null;

  const feed = firstLoad ? (
    <View>
      <SectionLabel>League activity</SectionLabel>
      <SkeletonRows count={5} height={50} />
    </View>
  ) : data ? (
    <View>
      <SectionLabel>League activity</SectionLabel>
      <ActivityFeed
        events={data.activity}
        players={players}
        meId={uid}
        onOpenMatch={(matchId) => router.push(`/(app)/match/${matchId}` as Href)}
        onOpenPlayer={openPlayer}
      />
    </View>
  ) : null;

  // Sections rise in (staggered) once data lands. Skeletons sit in a plain View, so the
  // swap to a Reveal remounts and the entrance plays exactly when real content arrives.
  const reveal = (node: ReactNode, index: number) =>
    !node ? null : data ? (
      <Reveal key={`r${index}`} index={index}>
        {node}
      </Reveal>
    ) : (
      <View key={`s${index}`}>{node}</View>
    );

  return (
    <Page
      edges={["top"]}
      width="wide"
      scrollRef={scrollRef}
      refreshing={refreshing}
      onRefresh={() => void reload()}
    >
      {header}
      {loadFailed && data ? (
        <ErrorCard
          message="Couldn't refresh — showing the last loaded data."
          onRetry={() => void reload()}
          retrying={refreshing}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
      {banners}
      {isDesktop ? (
        <Columns ratio={[5, 7]} gap={spacing.x3}>
          <View style={styles.stack}>
            {/* The inbox rides with the hero (not its own stack slot) so an empty inbox
                leaves no gap; its stable key keeps the live listener mounted when the
                hero swaps from skeleton to content. */}
            <View>
              {reveal(hero, 0)}
              {inbox}
            </View>
            {reveal(playNext, 1)}
            {reveal(nemesisCard, 2)}
          </View>
          <View style={styles.stack}>
            {reveal(position, 1)}
            {reveal(feed, 2)}
          </View>
        </Columns>
      ) : (
        <View style={styles.stack}>
          <View>
            {reveal(hero, 0)}
            {inbox}
          </View>
          {reveal(position, 1)}
          {reveal(playNext, 2)}
          {reveal(nemesisCard, 3)}
          {reveal(feed, 4)}
        </View>
      )}
    </Page>
  );
}

function Banner({
  icon,
  title,
  body,
  onPress,
}: {
  icon: "trophy" | "swords";
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      accessibilityRole="link"
      lift
      pressScale={0.99}
      style={styles.banner}
      hoverStyle={{ backgroundColor: mix(colors.surface, colors.accent, 8) }}
    >
      <View style={styles.bannerIcon}>
        <Icon name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="head" size={14.5}>
          {title}
        </Txt>
        <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
          {body}
        </Txt>
      </View>
      <Icon name="chevron" size={16} color={colors.textDim} />
    </Interactive>
  );
}

// Three short flickers then rest — a hot streak gets noticed without looping forever.
const FLICKER: CSSAnimationKeyframes = {
  "0%": { transform: [{ scale: 1 }, { rotate: "0deg" }] },
  "30%": { transform: [{ scale: 1.25 }, { rotate: "-8deg" }] },
  "60%": { transform: [{ scale: 0.95 }, { rotate: "6deg" }] },
  "100%": { transform: [{ scale: 1 }, { rotate: "0deg" }] },
};

function Flame({ size = 14 }: { size?: number }) {
  const reduced = useReducedMotion();
  const icon = <Icon name="flame" size={size} color={colors.gold} />;
  if (reduced) return icon;
  return (
    <Animated.View
      style={{
        animationName: FLICKER,
        animationDuration: 600,
        animationDelay: 700,
        animationIterationCount: 3,
        animationTimingFunction: "ease-in-out",
      }}
    >
      {icon}
    </Animated.View>
  );
}

function streakCopy(result: "W" | "D" | "L", count: number): string {
  if (result === "W") return `${count} WIN STREAK`;
  if (result === "L") return `${count} ${count === 1 ? "LOSS" : "LOSSES"} IN A ROW`;
  return `${count} DRAWN`;
}

/** Season ELO hero. The whole card opens your profile — nothing inside is pressable. */
function SeasonHero({
  season,
  standing,
  rankedCount,
  stats,
  onPress,
}: {
  season: Season;
  standing: Standing | null;
  rankedCount: number;
  stats: PlayerStats | null;
  onPress: () => void;
}) {
  const { isDesktop, isTablet } = useBreakpoint();
  const daysLeft = Math.max(0, Math.ceil((season.end.getTime() - Date.now()) / 86_400_000));
  const elo = standing?.elo ?? START_ELO;
  const games = standing ? standing.w + standing.d + standing.l : 0;
  const status = standing?.ranked
    ? `RANK #${standing.rank} OF ${rankedCount}`
    : standing
      ? `PLACEMENT · ${games}/${RANKED_AFTER_GAMES} GAMES`
      : "NOT ON THE TABLE YET";
  const streak =
    stats?.currentStreakType && stats.currentStreak > 0
      ? { type: stats.currentStreakType, count: stats.currentStreak }
      : null;
  const hot = streak?.type === "W" && streak.count >= 3;

  return (
    <Card
      style={styles.hero}
      padded
      onPress={onPress}
      accessibilityLabel={`Your season: ${elo} ELO, ${status.toLowerCase()}. Open your profile`}
    >
      <View style={styles.heroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={{ letterSpacing: 1.4 }}>
            YOUR SEASON · ELO
          </Txt>
          <CountUp
            value={elo}
            from={START_ELO}
            duration={1100}
            variant="monoBold"
            size={isDesktop ? 52 : 44}
            color={colors.accent}
            style={styles.heroElo}
          />
          <View style={styles.statusRow}>
            <Txt variant="mono" size={11.5} color={colors.textDim}>
              {status}
            </Txt>
            {standing?.ranked && standing.move ? (
              <Txt
                variant="monoBold"
                size={11.5}
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
        <View style={styles.seasonMeta}>
          {season.phase === "finals" ? (
            <>
              <Icon name="trophy" size={18} color={colors.gold} />
              <Txt variant="head" size={9.5} color={colors.textDim} style={{ marginTop: 2 }}>
                FINALS
              </Txt>
            </>
          ) : (
            <>
              <Txt variant="monoBold" size={18}>
                {daysLeft}
              </Txt>
              <Txt variant="head" size={9.5} color={colors.textDim} style={{ letterSpacing: 0.6 }}>
                {daysLeft === 1 ? "DAY LEFT" : "DAYS LEFT"}
              </Txt>
            </>
          )}
        </View>
      </View>
      <View style={styles.recordRow}>
        <Record value={standing?.w ?? 0} label="W" color={colors.win} />
        <Record value={standing?.d ?? 0} label="D" color={colors.draw} />
        <Record value={standing?.l ?? 0} label="L" color={colors.loss} />
        <Txt variant="head" size={8.5} color={colors.textFaint} style={{ letterSpacing: 1 }}>
          SEASON
        </Txt>
        <View style={{ flexGrow: 1 }} />
        {streak ? (
          <View style={styles.streak}>
            {hot ? <Flame /> : null}
            <Txt
              variant="monoBold"
              size={10}
              color={hot ? colors.gold : streak.type === "W" ? colors.accent : colors.textDim}
            >
              {streakCopy(streak.type, streak.count)}
            </Txt>
            <Txt variant="head" size={8.5} color={colors.textFaint} style={{ letterSpacing: 1 }}>
              ALL-TIME
            </Txt>
          </View>
        ) : null}
        {/* The affordance only fits beside the streak on tablet+; phones wrap it alone. */}
        {isTablet ? <Icon name="chevron" size={15} color={colors.textDim} /> : null}
      </View>
    </Card>
  );
}

/** No active season: say so plainly instead of a hero full of zeros. */
function BetweenSeasons({
  stats,
  isAdmin,
  onAdmin,
  onHistory,
}: {
  stats: PlayerStats | null;
  isAdmin: boolean;
  onAdmin: () => void;
  onHistory: () => void;
}) {
  return (
    <Card style={styles.between} padded>
      <View style={styles.betweenHead}>
        <View style={styles.betweenIcon}>
          <Icon name="calendar" size={22} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Tag tone="accent">BETWEEN SEASONS</Tag>
          <Txt variant="head" size={18} style={{ marginTop: 6 }}>
            No season is running right now
          </Txt>
          <Txt size={12.5} color={colors.textDim} style={{ marginTop: 3, lineHeight: 18 }}>
            {isAdmin
              ? "Start the next season from the admin dashboard and the table opens up."
              : "Your admin will kick off the next one — the table resets to 1500 when it starts."}
          </Txt>
        </View>
      </View>
      {stats && stats.games > 0 ? (
        <View style={styles.recordRow}>
          <Record value={stats.w} label="W" color={colors.win} />
          <Record value={stats.d} label="D" color={colors.draw} />
          <Record value={stats.l} label="L" color={colors.loss} />
          <Txt variant="head" size={8.5} color={colors.textFaint} style={{ letterSpacing: 1 }}>
            ALL-TIME
          </Txt>
          <View style={{ flex: 1 }} />
          <Txt variant="mono" size={11} color={colors.textDim}>
            {stats.winRate}% won
          </Txt>
        </View>
      ) : null}
      <View style={styles.betweenActions}>
        {isAdmin ? (
          <Button size="sm" icon="plus" onPress={onAdmin}>
            Start a season
          </Button>
        ) : null}
        <Button size="sm" variant="dark" icon="seasons" onPress={onHistory}>
          Season history
        </Button>
      </View>
    </Card>
  );
}

function Record({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
      <Txt variant="monoBold" size={16}>
        {value}
      </Txt>
      <Txt variant="head" size={9.5} color={color}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  stack: { gap: SECTION_GAP },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.55),
    borderRadius: radius.lg,
    backgroundColor: mix(colors.surface, colors.accent, 4),
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  hero: {
    backgroundColor: mix(colors.surface, colors.accent, 6),
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroElo: { marginTop: 4, letterSpacing: -1.2 },
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
  seasonMeta: {
    alignItems: "center",
    minWidth: 64,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recordRow: {
    flexDirection: "row",
    // Narrow phones push the streak onto its own line rather than clipping it.
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: spacing.md,
    rowGap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  streak: { flexDirection: "row", alignItems: "center", gap: 5 },
  between: {
    borderRadius: radius.xl,
    borderColor: withAlpha(colors.accent, 0.22),
    backgroundColor: mix(colors.surface, colors.accent, 4),
  },
  betweenHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  betweenIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  betweenActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  nemesisCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.2),
    borderRadius: radius.lg,
    backgroundColor: mix(colors.surface, colors.loss, 5),
  },
});
