/**
 * Confirmations inbox: results opponents logged against you, awaiting your verdict, plus
 * your own submissions still waiting on them. Each card says when it was played and what
 * confirming does to your rating, links through to the full match, and resolves with a
 * toast — the card animates out as the live listener drops it. Desktop lays the inbox out
 * as a card grid with "Waiting on them" as a side column.
 */
import { useCallback, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { type Href, useRouter } from "expo-router";
import {
  Avatar,
  Card,
  EloDelta,
  EmptyState,
  ErrorCard,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonCard,
  Tag,
  Txt,
} from "@/components";
import { VerdictActions } from "@/components/MatchVerdict";
import { StickySplit } from "@/components/StickySplit";
import { useAuth } from "@/lib/auth";
import { getLeaguePlayers, type LeaguePlayer, type PendingMatch } from "@/lib/league";
// Direct module import: the league barrel isn't extended for every leaf module.
import { getPendingImpacts, type PendingImpact } from "@/lib/league/pendingImpact";
import { usePendingConfirmations } from "@/lib/usePendingConfirmations";
import { useFocusData } from "@/lib/useFocusData";
import { useBreakpoint } from "@/lib/responsive";
import { firstName } from "@/lib/format";
import { playedAt, timeAgo } from "@/lib/when";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Player } from "@/types";

/** Minimum inbox card width before the grid drops to one column. */
const CARD_MIN = 340;
const GRID_GAP = spacing.md;

export default function Confirmations() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { isDesktop } = useBreakpoint();
  const [listenerError, setListenerError] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const {
    matches,
    outgoing,
    loaded: pendingLoaded,
  } = usePendingConfirmations(user?.uid, {
    onError: () =>
      setListenerError("The live inbox disconnected. Refresh, or come back to this tab to retry."),
  });

  const roster = useFocusData(
    "confirmations-roster",
    useCallback(async () => {
      const list = await getLeaguePlayers();
      return new Map(list.map((player) => [player.id, player]));
    }, []),
  );
  const players = roster.data ?? new Map<string, LeaguePlayer>();

  // Rating previews for what's in the inbox; re-keyed as cards arrive and leave.
  const impactKey = matches.map((match) => match.id).join(",");
  const impacts = useFocusData(`pending-impacts:${impactKey}`, () => getPendingImpacts(matches));
  const impactById = impacts.data ?? new Map<string, PendingImpact>();

  const refreshing = roster.refreshing || impacts.refreshing;
  const refresh = () => {
    setListenerError(null);
    void roster.reload();
    void impacts.reload();
  };
  const openMatch = (id: string) =>
    router.push({ pathname: "/(app)/match/[id]", params: { id } } as Href);

  // useFocusData reports `loading` only once its fetch is scheduled; until the roster has
  // arrived (or failed) treat the inbox as loading so cards never render nameless first.
  const rosterReady = roster.data !== undefined || roster.error;
  const loading = !rosterReady || !pendingLoaded;
  const columns =
    isDesktop && gridWidth > 0
      ? Math.max(1, Math.min(2, Math.floor((gridWidth + GRID_GAP) / (CARD_MIN + GRID_GAP))))
      : 1;
  const cardWidth =
    columns > 1 ? Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns) : undefined;

  const inbox = (
    // Measured even while loading, so desktop cards mount at their grid width instead of
    // animating in from full width.
    <View onLayout={(event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width)}>
      {listenerError ? (
        <ErrorCard
          message={listenerError}
          onRetry={refresh}
          retrying={refreshing}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
      {roster.error && !roster.data ? (
        <ErrorCard
          message="Couldn't load the league roster. Check your connection and retry."
          onRetry={() => void roster.reload()}
          retrying={roster.refreshing || roster.loading}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
      {isDesktop ? (
        <SectionLabel>{loading ? "Your verdict" : `Your verdict · ${matches.length}`}</SectionLabel>
      ) : null}
      {loading || (isDesktop && gridWidth === 0) ? (
        <View style={[styles.grid, { gap: GRID_GAP }]}>
          <View style={styles.skeletonWrap}>
            <SkeletonCard height={250} />
          </View>
          {isDesktop ? (
            <View style={styles.skeletonWrap}>
              <SkeletonCard height={250} />
            </View>
          ) : null}
        </View>
      ) : matches.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Inbox clear"
          body="No results are waiting for your confirmation. When an opponent logs a match against you, it lands here."
          action={{
            label: "Log a match",
            icon: "plus",
            onPress: () => router.push("/(app)/log-match"),
          }}
        />
      ) : (
        <View style={[styles.grid, { gap: GRID_GAP }]}>
          {matches.map((match, index) => {
            const meIsA = match.aId === uid;
            return (
              <Animated.View
                key={match.id}
                entering={FadeIn.duration(260).delay(Math.min(index, 6) * 50)}
                exiting={FadeOutUp.duration(260)}
                layout={LinearTransition.duration(280)}
                style={cardWidth ? { width: cardWidth } : styles.fullWidth}
              >
                <InboxCard
                  match={match}
                  meIsA={meIsA}
                  me={players.get(uid)}
                  opponent={players.get(meIsA ? match.bId : match.aId)}
                  impact={impactById.get(match.id)}
                  impactLoading={(impacts.data === undefined && !impacts.error) || impacts.stale}
                  onOpen={() => openMatch(match.id)}
                />
              </Animated.View>
            );
          })}
        </View>
      )}
    </View>
  );

  const waiting =
    !loading && (outgoing.length > 0 || isDesktop) ? (
      <View style={isDesktop ? undefined : { marginTop: spacing.x2 }}>
        <SectionLabel>{`Waiting on them${outgoing.length ? ` · ${outgoing.length}` : ""}`}</SectionLabel>
        {outgoing.length === 0 ? (
          <EmptyState
            compact
            icon="clock"
            title="Nothing outstanding"
            body="Results you log show here until your opponent confirms them."
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {outgoing.map((match, index) => (
              <Reveal key={match.id} index={index}>
                <OutgoingRow
                  match={match}
                  uid={uid}
                  opponent={players.get(match.aId === uid ? match.bId : match.aId)}
                  onOpen={() => openMatch(match.id)}
                />
              </Reveal>
            ))}
          </View>
        )}
      </View>
    ) : null;

  return (
    <Page
      header={
        <ScreenHeader
          title="Confirm results"
          subtitle="Only your opponent can put a result into the table."
          documentTitle="Inbox"
          onRefresh={refresh}
          refreshing={refreshing}
        />
      }
      width="wide"
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <StickySplit main={inbox} aside={waiting} ratio={[2, 1]} />
    </Page>
  );
}

function InboxCard({
  match,
  meIsA,
  me,
  opponent,
  impact,
  impactLoading,
  onOpen,
}: {
  match: PendingMatch;
  meIsA: boolean;
  me?: Player;
  opponent?: Player;
  impact?: PendingImpact;
  impactLoading: boolean;
  onOpen: () => void;
}) {
  const myGoals = meIsA ? match.aGoals : match.bGoals;
  const opponentGoals = meIsA ? match.bGoals : match.aGoals;
  const myTeam = meIsA ? match.aTeam : match.bTeam;
  const opponentTeam = meIsA ? match.bTeam : match.aTeam;
  const oppName = opponent ? firstName(opponent.name) : "Opponent";
  const myBefore = impact ? (meIsA ? impact.aEloBefore : impact.bEloBefore) : null;
  const myDelta = impact ? (meIsA ? impact.aDelta : impact.bDelta) : null;
  const result = myGoals > opponentGoals ? "win" : myGoals < opponentGoals ? "loss" : "draw";
  const confirmMessage =
    impact && !impact.finals && myBefore != null && myDelta != null
      ? `Confirmed ${myGoals}–${opponentGoals} vs ${oppName} · your ELO ${myBefore} → ${myBefore + myDelta}`
      : `Confirmed ${myGoals}–${opponentGoals} vs ${oppName} — it's in the table.`;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.pendingDot} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.kicker}>
            {impact?.finals ? "FINALS TIE · YOUR VERDICT" : "WAITING FOR YOUR VERDICT"}
          </Txt>
          <Txt size={12} color={colors.textFaint} style={{ marginTop: 3 }} numberOfLines={1}>
            Played {playedAt(match.date)} · logged by {oppName}
          </Txt>
        </View>
        {impact?.source === "ai_assisted" ? <Tag tone="accent">AI</Tag> : null}
        <Interactive
          onPress={onOpen}
          accessibilityRole="link"
          accessibilityLabel={`Open the match against ${oppName}`}
          style={styles.detailsLink}
          hoverStyle={{ backgroundColor: colors.surface2 }}
        >
          <Txt size={12} color={colors.textDim}>
            Details
          </Txt>
          <Icon name="arrowRight" size={13} color={colors.textDim} />
        </Interactive>
      </View>

      <View style={styles.scoreRow}>
        <Side player={me} label="You" team={myTeam} />
        <View style={{ alignItems: "center" }}>
          <Txt variant="monoBold" size={38}>
            {myGoals}
            <Txt variant="monoBold" size={38} color={colors.textFaint}>
              :
            </Txt>
            {opponentGoals}
          </Txt>
          <Txt
            variant="head"
            size={10}
            color={result === "win" ? colors.win : result === "loss" ? colors.loss : colors.draw}
            style={styles.kicker}
          >
            {result === "win" ? "YOU WON" : result === "loss" ? "YOU LOST" : "DRAW"}
          </Txt>
        </View>
        <Side player={opponent} label={oppName} team={opponentTeam} />
      </View>

      <View style={styles.impact}>
        <Icon name="trend" size={15} color={colors.textDim} />
        {impact?.finals ? (
          <Txt size={12.5} color={colors.textDim} style={{ flex: 1 }}>
            Finals tie — no ELO change, the winner advances.
          </Txt>
        ) : impact && myBefore != null && myDelta != null ? (
          <>
            <Txt size={12.5} color={colors.textDim} style={{ flex: 1 }} numberOfLines={1}>
              If you confirm
            </Txt>
            <Txt variant="mono" size={12.5} color={colors.textDim}>
              {myBefore} →{" "}
            </Txt>
            <Txt variant="monoBold" size={13.5}>
              {myBefore + myDelta}
            </Txt>
            <View style={{ width: 52, alignItems: "flex-end" }}>
              <EloDelta delta={myDelta} size={12} />
            </View>
          </>
        ) : impactLoading ? (
          <Skeleton width="60%" height={12} />
        ) : (
          <Txt size={12.5} color={colors.textFaint} style={{ flex: 1 }}>
            Rating preview unavailable
          </Txt>
        )}
      </View>

      <VerdictActions
        matchId={match.id}
        opponentName={oppName}
        confirmMessage={confirmMessage}
        confirmAction={{ label: "View", onPress: onOpen }}
      />
    </Card>
  );
}

function OutgoingRow({
  match,
  uid,
  opponent,
  onOpen,
}: {
  match: PendingMatch;
  uid: string;
  opponent?: Player;
  onOpen: () => void;
}) {
  const meIsA = match.aId === uid;
  const myGoals = meIsA ? match.aGoals : match.bGoals;
  const opponentGoals = meIsA ? match.bGoals : match.aGoals;
  const name = opponent ? firstName(opponent.name) : "your opponent";
  return (
    <Interactive
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={`You ${myGoals}–${opponentGoals} ${name}, waiting for confirmation`}
      style={styles.outgoing}
      hoverStyle={{ borderColor: colors.lineStrong, backgroundColor: colors.surface2 }}
    >
      <Avatar player={opponent} size={36} jersey />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
          You {myGoals}–{opponentGoals} {opponent ? firstName(opponent.name) : "Opponent"}
        </Txt>
        <Txt size={11.5} color={colors.textDim} style={{ marginTop: 2 }} numberOfLines={1}>
          Sent {timeAgo(match.date)} · waiting for {name}
        </Txt>
      </View>
      <Icon name="chevron" size={14} color={colors.textFaint} />
    </Interactive>
  );
}

function Side({ player, label, team }: { player?: Player; label: string; team: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <Avatar player={player} size={44} jersey />
      <Txt variant="bodyMedium" size={13} style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {label}
      </Txt>
      <Txt size={11} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
        {team}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  fullWidth: { width: "100%" },
  skeletonWrap: { flexGrow: 1, flexBasis: CARD_MIN },
  card: { gap: spacing.lg },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  kicker: { letterSpacing: 1.1 },
  detailsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  impact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.accent, 0.05),
    borderWidth: 1,
    borderColor: colors.line,
  },
  outgoing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
});
