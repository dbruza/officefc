/**
 * Home dashboard sections that answer the lunchtime questions:
 * - InboxSection — "is anything waiting on me / on them?" (pending confirmations, both ways)
 * - PositionTable — "where am I?" (leader + the places either side of me, with ELO gaps)
 * - PlayNextCard — "who should I play?" (fresh matchups, the player just above, cup ties)
 *
 * Kept out of the route file so the screen reads as layout; everything here is derived
 * from data Home already loads.
 */
import { useState } from "react";
import { MIN_RANKED_GAMES } from "@/lib/league/standings";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import { type Href, useRouter } from "expo-router";
import {
  Avatar,
  EASE_SPRING,
  EmptyState,
  ErrorCard,
  FormChips,
  Icon,
  Interactive,
  RankBadge,
  Reveal,
  SectionLabel,
  Tag,
  Txt,
} from "@/components";
import { relativeTime, useNow } from "@/components/ActivityFeed";
import type {
  CupState,
  HeadToHead,
  LeaguePlayer,
  PendingMatch,
  Season,
  Standing,
} from "@/lib/league";
import { usePendingConfirmations } from "@/lib/usePendingConfirmations";
import { useBreakpoint } from "@/lib/responsive";
import { firstName, plural } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

export const RANKED_AFTER_GAMES = MIN_RANKED_GAMES;
/** Everyone starts here; also the stand-in for players without a standing yet. */
export const START_ELO = 1500;

const POP: CSSAnimationKeyframes = {
  from: { transform: [{ scale: 0.4 }], opacity: 0 },
  to: { transform: [{ scale: 1 }], opacity: 1 },
};

/** A count badge that springs in — and re-springs whenever the count changes. */
function PopBadge({ count }: { count: number }) {
  const reduced = useReducedMotion();
  const body = (
    <Txt variant="monoBold" size={11} color={colors.onAccent}>
      {count}
    </Txt>
  );
  if (reduced) return <View style={styles.badge}>{body}</View>;
  return (
    <Animated.View
      key={count}
      style={{
        ...StyleSheet.flatten(styles.badge),
        animationName: POP,
        animationDuration: 420,
        animationDelay: 150,
        animationTimingFunction: EASE_SPRING,
        animationFillMode: "backwards",
      }}
    >
      {body}
    </Animated.View>
  );
}

/** "just now" / "2h ago" / "on 14 Sep" — relativeTime phrased for a sentence. */
function agoText(date: Date, now: number): string {
  const rel = relativeTime(date, now);
  if (rel === "now") return "just now";
  return /^\d+[mhd]$/.test(rel) ? `${rel} ago` : `on ${rel}`;
}

/** Score + outcome from `uid`'s side of a pending result. */
function myView(match: PendingMatch, uid: string) {
  const asA = match.aId === uid;
  const mine = asA ? match.aGoals : match.bGoals;
  const theirs = asA ? match.bGoals : match.aGoals;
  const outcome = mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
  return {
    opponentId: asA ? match.bId : match.aId,
    score: `${mine}–${theirs}`,
    outcome,
    tint: outcome === "win" ? colors.win : outcome === "loss" ? colors.loss : colors.draw,
  } as const;
}

// ---------------------------------------------------------------------------------------
// Inbox

/**
 * Live pending-confirmation summary. Owns its subscription so the parent can remount it
 * (new `key`) to retry: a Firestore listener is dead after an error, so "Retry" must
 * resubscribe — re-running the screen's data fetch never cleared the old error.
 */
export function InboxSection({
  uid,
  players,
  onRetry,
  style,
}: {
  uid: string;
  players: Map<string, LeaguePlayer>;
  onRetry: () => void;
  /** Applied only when something renders — an empty inbox must not leave a gap. */
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const now = useNow();
  const { isTablet } = useBreakpoint();
  const [failed, setFailed] = useState(false);
  const {
    matches: incoming,
    outgoing,
    loaded,
  } = usePendingConfirmations(uid, {
    onError: () => setFailed(true),
  });
  const openInbox = () => router.push("/(app)/confirmations");

  if (failed) {
    return (
      <ErrorCard
        message="Couldn't reach the confirmation inbox — results waiting on you may be missing."
        onRetry={onRetry}
        style={style}
      />
    );
  }
  if (!loaded || (incoming.length === 0 && outgoing.length === 0)) return null;

  const latest = incoming[0];
  const latestView = latest ? myView(latest, uid) : null;
  // The roster arrives with Home's main fetch; the live inbox can beat it, so phrase the
  // line without a name rather than flashing a placeholder.
  const latestPlayer = latestView ? players.get(latestView.opponentId) : undefined;

  // The live listener usually lands after the page has assembled, so it makes its own
  // entrance instead of relying on the screen's section stagger.
  return (
    <Reveal style={[{ gap: spacing.md }, style]}>
      {latest && latestView ? (
        <Interactive
          onPress={openInbox}
          accessibilityRole="link"
          accessibilityLabel={`${plural(incoming.length, "result")} waiting for your confirmation. Review`}
          pressScale={0.99}
          lift
          style={styles.pendingBanner}
          hoverStyle={{ borderColor: withAlpha(colors.accent, 0.7) }}
        >
          <View style={styles.pendingIcon}>
            <Icon name="inbox" size={22} color={colors.accent} />
            <View style={styles.badgeSlot}>
              <PopBadge count={incoming.length} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={15.5}>
              {incoming.length === 1
                ? "1 result needs your OK"
                : `${incoming.length} results need your OK`}
            </Txt>
            <Txt size={12.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
              {latestPlayer ? `${firstName(latestPlayer.name)} logged ` : "Logged "}
              <Txt size={12.5} variant="monoBold" color={latestView.tint}>
                {latestView.score} {latestView.outcome}
              </Txt>
              {latest.date ? ` · ${relativeTime(latest.date, now)}` : ""}
              {incoming.length > 1 ? ` · +${incoming.length - 1} more` : ""}
            </Txt>
          </View>
          <View style={styles.reviewPill}>
            {isTablet ? (
              <Txt variant="head" size={12} color={colors.onAccent}>
                Review
              </Txt>
            ) : null}
            <Icon name="arrowRight" size={14} color={colors.onAccent} />
          </View>
        </Interactive>
      ) : null}

      {outgoing.length ? (
        <View>
          <SectionLabel>Waiting on opponents</SectionLabel>
          <View style={styles.listCard}>
            {outgoing.slice(0, 3).map((match, index) => {
              const view = myView(match, uid);
              const opponent = players.get(view.opponentId);
              const name = firstName(opponent?.name ?? "Opponent");
              return (
                <Interactive
                  key={match.id}
                  onPress={openInbox}
                  accessibilityRole="link"
                  accessibilityLabel={`Waiting on ${name} to confirm your ${view.score} ${view.outcome}`}
                  pressScale={1}
                  style={[styles.listRow, index > 0 && styles.listDivider]}
                  hoverStyle={{ backgroundColor: colors.surface2 }}
                >
                  <Avatar player={opponent} size={30} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                      Waiting on {name}
                    </Txt>
                    <Txt variant="mono" size={10.5} color={colors.textDim} numberOfLines={1}>
                      {match.date ? `You logged it ${agoText(match.date, now)}` : "You logged it"}
                    </Txt>
                  </View>
                  <Txt variant="monoBold" size={15} color={view.tint}>
                    {view.score}
                  </Txt>
                  <Icon name="clock" size={14} color={colors.textFaint} />
                </Interactive>
              );
            })}
            {outgoing.length > 3 ? (
              <Interactive
                onPress={openInbox}
                accessibilityRole="link"
                pressScale={1}
                style={[styles.listRow, styles.listDivider, { justifyContent: "center" }]}
                hoverStyle={{ backgroundColor: colors.surface2 }}
              >
                <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
                  {`+${outgoing.length - 3} MORE IN YOUR INBOX`}
                </Txt>
              </Interactive>
            ) : null}
          </View>
        </View>
      ) : null}
    </Reveal>
  );
}

// ---------------------------------------------------------------------------------------
// Your position

function ColHead({ children, style }: { children: string; style?: TextStyle }) {
  return (
    <Txt variant="head" size={9.5} color={colors.textFaint} style={[styles.colHead, style]}>
      {children}
    </Txt>
  );
}

type PositionEntry = { kind: "row"; standing: Standing } | { kind: "gap"; key: string };

/** Leader + the places either side of me; top three when I'm not ranked yet. */
function positionSlice(uid: string, standings: Standing[]): PositionEntry[] {
  const ranked = standings.filter((s) => s.ranked);
  const me = standings.find((s) => s.uid === uid);
  let picked: Standing[];
  if (me?.ranked) {
    const at = ranked.findIndex((s) => s.uid === uid);
    const indexes = [...new Set([0, at - 1, at, at + 1])]
      .filter((i) => i >= 0 && i < ranked.length)
      .sort((a, b) => a - b);
    picked = indexes.map((i) => ranked[i]);
  } else {
    picked = ranked.slice(0, 3);
    if (me) picked = [...picked, me];
  }
  const entries: PositionEntry[] = [];
  picked.forEach((standing, i) => {
    const prev = picked[i - 1];
    // A visual "…" where the slice skips places (or between the table and a placement row).
    if (prev && (!standing.ranked || standing.rank - prev.rank > 1)) {
      entries.push({ kind: "gap", key: `gap-${standing.uid}` });
    }
    entries.push({ kind: "row", standing });
  });
  return entries;
}

function positionCaption(
  uid: string,
  standings: Standing[],
  players: Map<string, LeaguePlayer>,
): string {
  const ranked = standings.filter((s) => s.ranked);
  const me = standings.find((s) => s.uid === uid);
  const nameOf = (id: string) => firstName(players.get(id)?.name ?? "them");
  if (!me) return "Play a match to get on the table.";
  if (!me.ranked) {
    const left = Math.max(1, RANKED_AFTER_GAMES - (me.w + me.d + me.l));
    return `Placement — ${plural(left, "more game")} to get ranked.`;
  }
  const at = ranked.findIndex((s) => s.uid === uid);
  if (at === 0) {
    const second = ranked[1];
    return second
      ? `Top of the table — ${me.elo - second.elo} clear of ${nameOf(second.uid)}.`
      : "Top of the table.";
  }
  const above = ranked[at - 1];
  const gap = above.elo - me.elo;
  return gap > 0
    ? `${gap} behind ${nameOf(above.uid)} for #${above.rank}.`
    : `Level with ${nameOf(above.uid)} — #${above.rank} is there for the taking.`;
}

export function PositionTable({
  uid,
  standings,
  players,
  onOpenPlayer,
  onOpenTable,
  onLogMatch,
}: {
  uid: string;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  onOpenPlayer: (uid: string) => void;
  onOpenTable: () => void;
  onLogMatch: () => void;
}) {
  const { isTablet } = useBreakpoint();
  const entries = positionSlice(uid, standings);
  const me = standings.find((s) => s.uid === uid);
  const myElo = me?.elo ?? START_ELO;
  const ranked = standings.filter((s) => s.ranked).length;

  const tableLink = (
    <Interactive
      onPress={onOpenTable}
      accessibilityRole="link"
      pressScale={1}
      style={styles.textLink}
      hoverStyle={{ backgroundColor: colors.surface }}
    >
      <Txt variant="head" size={11} color={colors.accent} style={{ letterSpacing: 0.6 }}>
        FULL TABLE
      </Txt>
      <Icon name="chevron" size={12} color={colors.accent} />
    </Interactive>
  );

  if (entries.length === 0) {
    return (
      <View>
        <SectionLabel action={tableLink}>Your position</SectionLabel>
        <EmptyState
          compact
          icon="board"
          title="No confirmed results yet"
          body="Log a match, get the opponent's nod, and the table comes alive."
          action={{ label: "Log match", icon: "plus", onPress: onLogMatch }}
        />
      </View>
    );
  }

  return (
    <View>
      <SectionLabel action={tableLink}>Your position</SectionLabel>
      <View style={styles.listCard}>
        <View style={styles.positionHead}>
          <Txt size={12.5} color={colors.textDim} style={{ flex: 1 }}>
            {positionCaption(uid, standings, players)}
          </Txt>
          {ranked ? (
            <Txt variant="mono" size={10.5} color={colors.textFaint}>
              {ranked} RANKED
            </Txt>
          ) : null}
        </View>
        {isTablet ? (
          <View style={[styles.positionRow, styles.listDivider, styles.headRow]}>
            <ColHead style={{ width: 26, textAlign: "center" }}>#</ColHead>
            <ColHead style={{ flex: 1 }}>PLAYER</ColHead>
            <ColHead style={{ width: 112 }}>FORM</ColHead>
            <ColHead style={styles.numCol}>ELO</ColHead>
            <ColHead style={styles.numCol}>GAP</ColHead>
          </View>
        ) : null}
        {entries.map((entry) => {
          if (entry.kind === "gap") {
            return (
              <View key={entry.key} style={[styles.gapRow, styles.listDivider]}>
                <Txt variant="monoBold" size={11} color={colors.textDisabled}>
                  · · ·
                </Txt>
              </View>
            );
          }
          const { standing } = entry;
          const player = players.get(standing.uid);
          if (!player) return null;
          const you = standing.uid === uid;
          const gap = standing.elo - myElo;
          return (
            <Interactive
              key={standing.uid}
              onPress={() => onOpenPlayer(standing.uid)}
              accessibilityRole="link"
              accessibilityLabel={`${player.name}${you ? " (you)" : ""}, ${
                standing.ranked ? `rank ${standing.rank}` : "placement"
              }, ${standing.elo} ELO`}
              pressScale={1}
              style={[
                styles.positionRow,
                styles.listDivider,
                you && { backgroundColor: mix(colors.surface, colors.accent, 9) },
              ]}
              hoverStyle={{
                backgroundColor: you ? mix(colors.surface, colors.accent, 14) : colors.surface2,
              }}
            >
              {standing.ranked ? (
                <RankBadge rank={standing.rank} />
              ) : (
                <View style={styles.rankSlot}>
                  <Txt variant="monoBold" size={11} color={colors.textFaint}>
                    –
                  </Txt>
                </View>
              )}
              <Avatar player={player} size={30} />
              <View style={styles.nameCell}>
                <Txt variant="bodyMedium" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {isTablet ? player.name : firstName(player.name)}
                </Txt>
                {you ? <Tag tone="accent">YOU</Tag> : null}
                {!standing.ranked ? <Tag>PLACEMENT</Tag> : null}
              </View>
              {isTablet ? (
                <View style={{ width: 112 }}>
                  <FormChips results={standing.form} size={16} gap={3} />
                </View>
              ) : null}
              <Txt variant="monoBold" size={15} style={styles.numCol}>
                {standing.elo}
              </Txt>
              <Txt
                variant="mono"
                size={12}
                color={you ? colors.textFaint : gap > 0 ? colors.textDim : colors.textFaint}
                style={styles.numCol}
              >
                {you ? "—" : gap > 0 ? `+${gap}` : gap < 0 ? `−${Math.abs(gap)}` : "±0"}
              </Txt>
            </Interactive>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// Play next

interface Suggestion {
  player: LeaguePlayer;
  reason: string;
  kind: "cup" | "fresh" | "chase" | "defend" | "rematch";
}

/** The viewer's unresolved cup tie, if the cup is live and they're still in it. */
function myCupOpponent(cup: CupState | null, uid: string): string | null {
  if (!cup || cup.status !== "live") return null;
  for (const round of cup.rounds) {
    for (const tie of round) {
      if (tie.winnerId !== null || !tie.aId || !tie.bId) continue;
      if (tie.aId === uid) return tie.bId;
      if (tie.bId === uid) return tie.aId;
    }
  }
  return null;
}

/**
 * Who to play next: the open cup tie first, then the closest-rated opponent not yet faced
 * this season, the player directly above (the one to catch), and more fresh matchups.
 * Falls back to defending against the player below / least-played rematches.
 */
export function suggestOpponents({
  uid,
  season,
  standings,
  players,
  headToHeads,
  cup,
  max = 3,
}: {
  uid: string;
  season: Season;
  standings: Standing[];
  players: Map<string, LeaguePlayer>;
  headToHeads: HeadToHead[];
  cup: CupState | null;
  max?: number;
}): Suggestion[] {
  const byUid = new Map(standings.map((s) => [s.uid, s]));
  const me = byUid.get(uid);
  const myElo = me?.elo ?? START_ELO;
  const eloOf = (id: string) => byUid.get(id)?.elo ?? START_ELO;
  const seasonMeetings = new Map<string, number>();
  const allTime = new Map<string, { w: number; d: number; l: number }>();
  for (const pair of headToHeads) {
    const asA = pair.aId === uid;
    const opponent = asA ? pair.bId : pair.aId;
    allTime.set(opponent, {
      w: asA ? pair.aWins : pair.bWins,
      d: pair.draws,
      l: asA ? pair.bWins : pair.aWins,
    });
    seasonMeetings.set(opponent, pair.meetings.filter((m) => m.seasonId === season.id).length);
  }
  const opponents = [...players.values()].filter((p) => p.id !== uid);
  const closeness = (a: LeaguePlayer, b: LeaguePlayer) =>
    Math.abs(eloOf(a.id) - myElo) - Math.abs(eloOf(b.id) - myElo);

  const out: Suggestion[] = [];
  const add = (player: LeaguePlayer | undefined, kind: Suggestion["kind"], reason: string) => {
    if (!player || out.length >= max || out.some((s) => s.player.id === player.id)) return;
    out.push({ player, kind, reason });
  };
  const freshReason = (id: string) => {
    const record = allTime.get(id);
    return record && record.w + record.d + record.l > 0
      ? `Not played this season · ${record.w}-${record.d}-${record.l} all-time`
      : `Never played · ${eloOf(id)} ELO`;
  };

  const cupOpponent = myCupOpponent(cup, uid);
  if (cupOpponent) add(players.get(cupOpponent), "cup", "Your cup tie — winner goes through");

  const fresh = opponents.filter((p) => !(seasonMeetings.get(p.id) ?? 0)).sort(closeness);
  if (fresh[0]) add(fresh[0], "fresh", freshReason(fresh[0].id));

  const ranked = standings.filter((s) => s.ranked);
  const at = me?.ranked ? ranked.findIndex((s) => s.uid === uid) : -1;
  const above = at > 0 ? ranked[at - 1] : null;
  if (above) {
    const gap = above.elo - myElo;
    add(
      players.get(above.uid),
      "chase",
      gap > 0 ? `${gap} ELO above you — the one to catch` : "Level on ELO — settle it",
    );
  }
  fresh.slice(1).forEach((p) => add(p, "fresh", freshReason(p.id)));

  const below = at >= 0 ? ranked[at + 1] : null;
  if (below)
    add(players.get(below.uid), "defend", `${myElo - below.elo} behind you — hold them off`);

  opponents
    .slice()
    .sort(
      (a, b) =>
        (seasonMeetings.get(a.id) ?? 0) - (seasonMeetings.get(b.id) ?? 0) || closeness(a, b),
    )
    .forEach((p) =>
      add(p, "rematch", `Played ${plural(seasonMeetings.get(p.id) ?? 0, "time")} this season`),
    );
  return out;
}

const KIND_ICON = {
  cup: "swords",
  fresh: "sparkle",
  chase: "up",
  defend: "shield",
  rematch: "refresh",
} as const;

export function PlayNextCard({
  suggestions,
  placementLeft,
  onPlay,
}: {
  suggestions: Suggestion[];
  /** Games still needed to get ranked (0 when ranked). */
  placementLeft: number;
  onPlay: (opponentId: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View>
      <SectionLabel
        action={
          placementLeft > 0 ? (
            <Txt variant="monoBold" size={11} color={colors.accent}>
              {plural(placementLeft, "more game")} to rank
            </Txt>
          ) : undefined
        }
      >
        Play next
      </SectionLabel>
      <View style={styles.listCard}>
        {suggestions.map((s, index) => (
          <Interactive
            key={s.player.id}
            onPress={() => onPlay(s.player.id)}
            accessibilityRole="link"
            accessibilityLabel={`Log a match against ${s.player.name}. ${s.reason}`}
            pressScale={1}
            style={[styles.listRow, index > 0 && styles.listDivider]}
            hoverStyle={{ backgroundColor: colors.surface2 }}
          >
            {({ hovered }) => (
              <>
                <Avatar player={s.player} size={36} jersey />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyMedium" size={14} numberOfLines={1}>
                    {s.player.name}
                  </Txt>
                  <View style={styles.reasonRow}>
                    <Icon
                      name={KIND_ICON[s.kind]}
                      size={11}
                      color={s.kind === "cup" ? colors.gold : colors.textDim}
                    />
                    <Txt
                      size={11.5}
                      color={s.kind === "cup" ? colors.gold : colors.textDim}
                      numberOfLines={1}
                      style={{ flexShrink: 1 }}
                    >
                      {s.reason}
                    </Txt>
                  </View>
                </View>
                <View
                  style={[
                    styles.playPill,
                    hovered && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Icon
                    name="plus"
                    size={13}
                    stroke={2.6}
                    color={hovered ? colors.onAccent : colors.accent}
                  />
                  <Txt variant="head" size={12} color={hovered ? colors.onAccent : colors.accent}>
                    Log
                  </Txt>
                </View>
              </>
            )}
          </Interactive>
        ))}
      </View>
    </View>
  );
}

/** Route for logging a match with the opponent pre-selected. */
export function logMatchHref(opponentId: string): Href {
  return { pathname: "/(app)/log-match", params: { opponent: opponentId } } as Href;
}

const styles = StyleSheet.create({
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.45),
    backgroundColor: mix(colors.surface, colors.accent, 10),
  },
  pendingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  badgeSlot: { position: "absolute", top: -4, right: -6 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  reviewPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  listRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  listDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  positionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  positionRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  colHead: { letterSpacing: 1 },
  headRow: { minHeight: 0, paddingVertical: 6 },
  rankSlot: { width: 26, alignItems: "center" },
  nameCell: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  numCol: { width: 48, textAlign: "right" },
  gapRow: { alignItems: "center", paddingVertical: 2 },
  textLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: -6,
    borderRadius: radius.sm,
  },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  playPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.4),
  },
});
