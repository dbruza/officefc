/**
 * Season recap as a "Wrapped"-style story for one finalized season: champion → awards →
 * rivalry → moments → your season → a shareable card. Slides whose data is missing are
 * skipped (pre-recap seasons still get the champion and the card). Tap the halves, use the
 * footer arrows, or ← → on web.
 *
 * Sharing: native captures the card with react-native-view-shot and opens the share
 * sheet; web rasterises it (view-shot's html2canvas build) and shares or downloads the
 * PNG, with "Copy link" always available.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, EmptyState, ErrorCard, Page, ScreenHeader, Skeleton } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  getEloHistory,
  getLeaguePlayers,
  getSeason,
  getSeasonResult,
  getStandings,
  loadRecap,
  type EloHistoryPoint,
  type LeaguePlayer,
  type Season,
  type SeasonRecap,
  type SeasonResult,
  type Standing,
} from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { logger } from "@/lib/logger";
import { showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { useBreakpoint } from "@/lib/responsive";
import { AWARD_META } from "@/lib/awards";
import { colors, radius, spacing } from "@/theme";
import { RecapStory, type StorySlide } from "@/screens/recap/RecapStory";
import {
  AwardsSlide,
  ChampionSlide,
  MomentsSlide,
  RivalrySlide,
  ShareCard,
  YouSlide,
  awardTiles,
  MOMENT_TINT,
  RIVALRY_TINT,
  type YouData,
} from "@/screens/recap/slides";
import {
  canShareFilesOnWeb,
  captureCard,
  copyToClipboard,
  shareImageNative,
  shareOrDownloadWeb,
} from "@/screens/recap/share";

interface RecapData {
  season: Season | null;
  result: SeasonResult | null;
  recap: SeasonRecap | null;
  players: Map<string, LeaguePlayer>;
  standings: Standing[];
  myHistory: EloHistoryPoint[];
}

/** Every season starts players here (functions/src/elo.ts BASE_ELO) — the fallback when a
 *  player's history doc is missing. */
const SEASON_START_ELO = 1500;

export default function RecapRoute() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { isPhone } = useBreakpoint();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [celebrated, setCelebrated] = useState(false);

  const { data, error, reload, refreshing } = useFocusData<RecapData>(
    `recap:${seasonId}`,
    useCallback(async () => {
      const [seasonRow, result, recap, roster, standings, myHistory] = await Promise.all([
        getSeason(seasonId),
        getSeasonResult(seasonId),
        loadRecap(seasonId),
        getLeaguePlayers(),
        // The personal slide is a bonus: its reads must never sink the whole recap.
        getStandings(seasonId).catch(() => [] as Standing[]),
        uid
          ? getEloHistory(seasonId, uid).catch(() => [] as EloHistoryPoint[])
          : Promise.resolve([] as EloHistoryPoint[]),
      ]);
      return {
        season: seasonRow,
        result,
        recap,
        players: new Map(roster.map((player) => [player.id, player])),
        standings,
        myHistory,
      };
    }, [seasonId, uid]),
  );

  const season = data?.season ?? null;
  const result = data?.result ?? null;
  const recap = data?.recap ?? null;
  const players = useMemo(() => data?.players ?? new Map<string, LeaguePlayer>(), [data]);
  const seasonName = season?.name ?? "Season";

  const champion = result ? players.get(result.championId) : undefined;
  const runnerUp = result ? players.get(result.runnerUpId) : undefined;
  const premier = result?.premierId ? players.get(result.premierId) : undefined;
  const format = result?.format ?? "table";

  const slides: StorySlide[] = [];
  if (result && data) {
    slides.push({
      key: "champion",
      title: "Champion",
      tint: colors.gold,
      render: () => (
        <ChampionSlide
          seasonName={seasonName}
          champion={champion}
          runnerUp={runnerUp}
          premier={premier}
          format={format}
          celebrate={!celebrated}
          onCelebrated={() => setCelebrated(true)}
        />
      ),
    });

    const tiles = recap ? awardTiles(recap, players) : [];
    if (tiles.length) {
      slides.push({
        key: "awards",
        title: "Season awards",
        tint: AWARD_META.improved.accent,
        render: () => <AwardsSlide tiles={tiles} />,
      });
    }

    const rivalA = recap?.biggestRivalry ? players.get(recap.biggestRivalry.aId) : undefined;
    const rivalB = recap?.biggestRivalry ? players.get(recap.biggestRivalry.bId) : undefined;
    if (recap?.biggestRivalry && rivalA && rivalB) {
      const games = recap.biggestRivalry.games;
      slides.push({
        key: "rivalry",
        title: "Biggest rivalry",
        tint: RIVALRY_TINT,
        render: () => <RivalrySlide a={rivalA} b={rivalB} games={games} />,
      });
    }

    const gots = recap?.gameOfTheSeason;
    const gameA = gots ? players.get(gots.aId) : undefined;
    const gameB = gots ? players.get(gots.bId) : undefined;
    const game =
      gots && gameA && gameB
        ? { a: gameA, b: gameB, aGoals: gots.aGoals, bGoals: gots.bGoals }
        : undefined;
    const upsetWinner = recap?.biggestUpset ? players.get(recap.biggestUpset.winnerId) : undefined;
    const upset =
      recap?.biggestUpset && upsetWinner
        ? {
            winner: upsetWinner,
            loser: players.get(recap.biggestUpset.loserId),
            upset: recap.biggestUpset,
          }
        : undefined;
    if (game || upset) {
      slides.push({
        key: "moments",
        title: game ? "Game of the season" : "Biggest upset",
        tint: MOMENT_TINT,
        render: () => <MomentsSlide game={game} upset={upset} />,
      });
    }

    const you = uid ? youData(uid, data, result, tiles) : null;
    if (you) {
      slides.push({
        key: "you",
        title: "Your season",
        tint: colors.accent,
        render: () => <YouSlide you={you} />,
      });
    }

    slides.push({
      key: "share",
      title: "Share",
      tint: AWARD_META.glove.accent,
      interactive: true,
      render: () => (
        <ShareCard
          cardRef={cardRef}
          seasonName={seasonName}
          champion={champion}
          runnerUp={runnerUp}
          premier={premier}
          format={format}
          recap={recap}
          players={players}
        />
      ),
    });
  }

  const fileName = `officefc-${seasonId}-recap.png`;

  async function shareNative() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureCard(cardRef.current);
      const shared = await shareImageNative(uri, `${seasonName} recap`);
      if (!shared) showAlert("Sharing unavailable", "Sharing isn't supported on this device.");
    } catch (shareError) {
      logger.warn("recap_share_failed", { error: String(shareError) });
      showAlert("Couldn't share", "Something went wrong preparing the card. Try again.");
    } finally {
      setSharing(false);
    }
  }

  async function copyLink() {
    const ok = await copyToClipboard(typeof window !== "undefined" ? window.location.href : "");
    if (ok) toast.success("Recap link copied");
    else toast.error("Couldn't copy the link — copy it from the address bar instead.");
  }

  async function shareWeb() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      const dataUri = await captureCard(cardRef.current);
      const outcome = await shareOrDownloadWeb(dataUri, fileName, `${seasonName} recap`);
      if (outcome === "downloaded") toast.success("Recap image saved");
    } catch (shareError) {
      // Image export is a nicety on web: degrade to the link rather than a dead end.
      logger.warn("recap_share_failed", { error: String(shareError), surface: "web" });
      toast.error("Couldn't create the image. Share the link instead.", {
        action: { label: "Copy link", onPress: () => void copyLink() },
      });
    } finally {
      setSharing(false);
    }
  }

  const canShareFiles = useMemo(() => canShareFilesOnWeb(), []);
  const actions = (key: string) => {
    if (key !== "share") return null;
    if (Platform.OS !== "web") {
      return (
        <Button size="sm" icon="share" loading={sharing} onPress={() => void shareNative()}>
          Share recap
        </Button>
      );
    }
    return (
      <>
        <Button
          size="sm"
          icon={canShareFiles ? "share" : "download"}
          loading={sharing}
          onPress={() => void shareWeb()}
        >
          {canShareFiles ? "Share image" : "Save image"}
        </Button>
        <Button size="sm" variant="dark" icon="link" onPress={() => void copyLink()}>
          Copy link
        </Button>
      </>
    );
  };

  return (
    <Page
      scroll={false}
      header={<ScreenHeader title="Season recap" subtitle={season?.name ?? undefined} />}
      contentStyle={isPhone ? styles.bleed : styles.stage}
    >
      {error ? (
        <ErrorCard
          message="Couldn't load this recap. Check the connection and retry."
          onRetry={reload}
          retrying={refreshing}
          style={{ marginBottom: spacing.md, marginHorizontal: isPhone ? spacing.lg : 0 }}
        />
      ) : null}

      {!data && !error ? (
        <View style={styles.skeleton} accessibilityLabel="Loading" accessibilityRole="progressbar">
          <Skeleton
            width={isPhone ? "100%" : 380}
            height={isPhone ? 520 : 640}
            round={isPhone ? 0 : radius.xl}
          />
        </View>
      ) : null}

      {data && !error && !result ? (
        <View style={{ paddingHorizontal: isPhone ? spacing.lg : 0 }}>
          <EmptyState
            icon="trophy"
            title="Nothing to recap yet"
            body="This season hasn't been finalized, so there's no recap to show."
          />
        </View>
      ) : null}

      {slides.length ? <RecapStory slides={slides} actions={actions} /> : null}
    </Page>
  );
}

/** The viewer's own season, or null when they didn't play in it. */
function youData(
  uid: string,
  data: RecapData,
  result: SeasonResult,
  tiles: ReturnType<typeof awardTiles>,
): YouData | null {
  const standing = data.standings.find((row) => row.uid === uid);
  if (!standing || standing.w + standing.d + standing.l === 0) return null;
  const honours: string[] = [];
  if (result.championId === uid) honours.push("Champion");
  if (result.runnerUpId === uid) honours.push("Runner-up");
  if (result.format === "finals" && result.premierId === uid) honours.push("Premier");
  for (const tile of tiles) if (tile.player.id === uid) honours.push(tile.label);
  return {
    rank: standing.ranked ? standing.rank : null,
    of: data.standings.filter((row) => row.ranked).length,
    w: standing.w,
    d: standing.d,
    l: standing.l,
    eloStart: data.myHistory[0]?.rating ?? SEASON_START_ELO,
    eloEnd: standing.elo,
    history: data.myHistory.map((point) => ({
      date: point.date.toISOString().slice(0, 10),
      rating: point.rating,
    })),
    honours,
  };
}

const styles = StyleSheet.create({
  bleed: { paddingHorizontal: 0, paddingBottom: spacing.sm },
  stage: { paddingBottom: spacing.lg },
  skeleton: { flex: 1, alignItems: "center", justifyContent: "center" },
});
