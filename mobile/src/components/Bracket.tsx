/**
 * Knockout bracket views shared by the finals and the mid-season cup.
 *
 * - `BracketTree` (desktop): round columns left → right, each tie vertically centred on
 *   the ties that feed it, joined by SVG elbow connectors. Connectors carry state: dashed
 *   while undecided, accent once a winner went through, full accent along the viewer's own
 *   route, and gold along the champion's road to the title.
 * - `BracketList` (phones/tablets): one round at a time behind a Segmented round switcher.
 * - `TieCard`: the compact two-row tie card both views render.
 *
 * Screens describe ties as plain `BracketTie` models (sides, status, feeders); this file
 * owns geometry only. Card heights are fixed per part (header, rows, optional footer) so
 * the tree can be laid out without measuring every card.
 */
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal, Skeleton } from "./motion";
import { Grid } from "./Page";
import { Segmented } from "./Segmented";
import { Tag } from "./feedback";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { useBreakpoint } from "@/lib/responsive";
import type { Player } from "@/types";

export type TieStatus = "pending" | "open" | "decided";

export interface BracketSide {
  /** Player id; null while the side waits on an earlier tie (or never filled: a bye). */
  id: string | null;
  player: Player | null;
  /** Shown when there's no player: "Winner of SF 1", "Bye". */
  placeholder: string;
  seed?: number | null;
  /** Second line under the name, e.g. the dealt team. */
  sub?: string | null;
}

export interface BracketTie {
  id: string;
  label: string;
  status: TieStatus;
  /** Chip text once decided ("FT", "AET", "PENS", "W/O"). */
  result?: string | null;
  sides: [BracketSide, BracketSide];
  winnerId: string | null;
  /** The title decider — its winner gets the trophy treatment. */
  final?: boolean;
  /** Earlier ties whose winners fill this tie, with the side each one fills. */
  feeders: Array<{ id: string; side: 0 | 1 }>;
  /** Makes the card a link (e.g. to the deciding match). Ignored when `footer` is set. */
  onPress?: () => void;
  /** Extra strip under the sides (admin actions). Never put the card's own link here. */
  footer?: ReactNode;
}

export interface BracketRound {
  key: string;
  label: string;
  /** Segmented label on phones ("Semis"). */
  shortLabel: string;
  ties: BracketTie[];
}

// --- Geometry ------------------------------------------------------------------------

const BORDER = 1;
const HEADER_H = 30;
const ROW_H = 46;
const FOOTER_H = 48;
const ROUND_HEAD_H = 44;
const V_GAP = 20;
const COL_GAP_MIN = 52;
const COL_GAP_MAX = 120;
const CARD_MIN = 200;
const CARD_MAX = 264;
/** Narrower tree cards shorten names ("Sam W.") and the status chip so neither truncates. */
const COMPACT_BELOW = 248;

function tieHeight(tie: BracketTie): number {
  return BORDER * 2 + HEADER_H + ROW_H * 2 + (tie.footer ? FOOTER_H : 0);
}

/** Y of a side row's centre, from the card's top edge. */
function sideAnchor(side: 0 | 1): number {
  return BORDER + HEADER_H + ROW_H / 2 + side * ROW_H;
}

/** Y of the seam between the two rows — where an undecided tie's connector leaves. */
const MID_ANCHOR = BORDER + HEADER_H + ROW_H;

interface Placed {
  tie: BracketTie;
  col: number;
  top: number;
  height: number;
}

/**
 * Columns are ordered by a depth-first walk from the final, so every feeder sits beside
 * the tie it feeds (the finals' E2 feeds SF1, so E2 draws above E1). Then, column by
 * column: a tie with two placed feeders centres its rows between them; with one feeder it
 * lines the row that feeder fills up with the feeder's exit, so the connector runs
 * straight; feederless ties stack. Overlaps push down.
 */
function layoutBracket(rounds: BracketRound[]): { placed: Map<string, Placed>; height: number } {
  const colOf = new Map<string, number>();
  const byId = new Map<string, BracketTie>();
  rounds.forEach((round, c) =>
    round.ties.forEach((tie) => {
      colOf.set(tie.id, c);
      byId.set(tie.id, tie);
    }),
  );

  const order: string[][] = rounds.map(() => []);
  const seen = new Set<string>();
  const visit = (id: string) => {
    const tie = byId.get(id);
    if (!tie || seen.has(id)) return;
    seen.add(id);
    [...tie.feeders].sort((a, b) => a.side - b.side).forEach((feeder) => visit(feeder.id));
    order[colOf.get(id) ?? 0].push(id);
  };
  for (let c = rounds.length - 1; c >= 0; c--) rounds[c].ties.forEach((tie) => visit(tie.id));

  const placed = new Map<string, Placed>();
  order.forEach((ids, col) => {
    let prevBottom: number | null = null;
    for (const id of ids) {
      const tie = byId.get(id);
      if (!tie) continue;
      const height = tieHeight(tie);
      const exits = tie.feeders
        .map((feeder) => {
          const from = placed.get(feeder.id);
          return from ? { y: from.top + MID_ANCHOR, side: feeder.side } : null;
        })
        .filter((exit): exit is { y: number; side: 0 | 1 } => exit !== null);
      let top: number;
      if (exits.length >= 2) {
        top = exits.reduce((sum, exit) => sum + exit.y, 0) / exits.length - MID_ANCHOR;
      } else if (exits.length === 1) {
        top = exits[0].y - sideAnchor(exits[0].side);
      } else {
        top = prevBottom === null ? 0 : prevBottom + V_GAP;
      }
      if (prevBottom !== null) top = Math.max(top, prevBottom + V_GAP);
      placed.set(id, { tie, col, top, height });
      prevBottom = top + height;
    }
  });

  let minTop = Infinity;
  let maxBottom = 0;
  placed.forEach((p) => {
    minTop = Math.min(minTop, p.top);
  });
  if (!Number.isFinite(minTop)) minTop = 0;
  placed.forEach((p) => {
    p.top -= minTop;
    maxBottom = Math.max(maxBottom, p.top + p.height);
  });
  return { placed, height: maxBottom };
}

/** Elbow from (x1,y1) to (x2,y2) turning at xm, with softened corners. */
function elbowPath(x1: number, y1: number, x2: number, y2: number, xm: number): string {
  const dy = y2 - y1;
  if (Math.abs(dy) < 1) return `M${x1} ${y1} H${x2}`;
  const s = dy > 0 ? 1 : -1;
  const r = Math.max(0, Math.min(8, Math.abs(dy) / 2, xm - x1, x2 - xm));
  return [
    `M${x1} ${y1}`,
    `H${xm - r}`,
    `Q${xm} ${y1} ${xm} ${y1 + s * r}`,
    `V${y2 - s * r}`,
    `Q${xm} ${y2} ${xm + r} ${y2}`,
    `H${x2}`,
  ].join(" ");
}

type EdgeState = "pending" | "advanced" | "mine" | "champion";
const EDGE_RANK: Record<EdgeState, number> = { pending: 0, advanced: 1, mine: 2, champion: 3 };

function edgeState(
  feeder: BracketTie,
  viewerId: string | null,
  championId: string | null,
): EdgeState {
  if (feeder.status !== "decided" || !feeder.winnerId) return "pending";
  if (championId && feeder.winnerId === championId) return "champion";
  if (viewerId && feeder.winnerId === viewerId) return "mine";
  return "advanced";
}

const EDGE_STYLE: Record<EdgeState, { stroke: string; width: number; dash?: string }> = {
  pending: { stroke: colors.lineStrong, width: 1.5, dash: "4 5" },
  advanced: { stroke: withAlpha(colors.accent, 0.5), width: 1.75 },
  mine: { stroke: colors.accent, width: 2.5 },
  champion: { stroke: colors.gold, width: 2.75 },
};

// --- Tree (desktop) ------------------------------------------------------------------

export function BracketTree({
  rounds,
  viewerId,
  championId,
  roundMeta,
}: {
  rounds: BracketRound[];
  viewerId: string | null;
  championId: string | null;
  /** Optional caption under each round header ("1 to play"). */
  roundMeta?: (round: BracketRound) => string | null;
}) {
  const [avail, setAvail] = useState(0);
  const cols = Math.max(1, rounds.length);
  const fit = avail > 0 ? (avail - COL_GAP_MIN * (cols - 1)) / cols : CARD_MAX;
  const cardW = Math.floor(Math.max(CARD_MIN, Math.min(CARD_MAX, fit)));
  // Spare room widens the gutters (connectors read better) before the tree centres.
  const gap =
    cols > 1 && avail > 0
      ? Math.max(COL_GAP_MIN, Math.min(COL_GAP_MAX, (avail - cardW * cols) / (cols - 1)))
      : COL_GAP_MIN;
  const totalW = cardW * cols + gap * (cols - 1);
  const scrolls = avail > 0 && totalW > avail + 1;
  const { placed, height } = layoutBracket(rounds);
  const x = (col: number) => col * (cardW + gap);

  const edges: Array<{ key: string; d: string; state: EdgeState }> = [];
  placed.forEach((target) => {
    for (const feeder of target.tie.feeders) {
      const from = placed.get(feeder.id);
      if (!from) continue;
      const state = edgeState(from.tie, viewerId, championId);
      // A decided tie's line leaves from the winner's row; otherwise from between rows.
      const winnerSide = from.tie.sides.findIndex(
        (side) => side.id !== null && side.id === from.tie.winnerId,
      );
      const y1 =
        from.top + (winnerSide === 0 || winnerSide === 1 ? sideAnchor(winnerSide) : MID_ANCHOR);
      const x1 = x(from.col) + cardW;
      const x2 = x(target.col);
      const y2 = target.top + sideAnchor(feeder.side);
      edges.push({
        key: `${from.tie.id}->${target.tie.id}`,
        d: elbowPath(x1, y1, x2, y2, x2 - gap / 2),
        state,
      });
    }
  });
  edges.sort((a, b) => EDGE_RANK[a.state] - EDGE_RANK[b.state]);

  const tree = (
    <View style={{ width: totalW, height: ROUND_HEAD_H + height }}>
      {rounds.map((round, col) => {
        const meta = roundMeta?.(round);
        return (
          <Reveal
            key={round.key}
            from="fade"
            delay={col * 110}
            style={[styles.roundHead, { left: x(col), width: cardW }]}
          >
            <Txt variant="head" size={11} color={colors.textDim} style={styles.eyebrow}>
              {round.label.toUpperCase()}
            </Txt>
            {meta ? (
              <Txt size={11} color={colors.textFaint} style={{ marginTop: 2 }}>
                {meta}
              </Txt>
            ) : null}
          </Reveal>
        );
      })}

      <Reveal
        from="fade"
        delay={cols * 110 + 120}
        duration={520}
        style={{
          position: "absolute",
          left: 0,
          top: ROUND_HEAD_H,
          width: totalW,
          height,
          pointerEvents: "none",
        }}
      >
        <Svg width={totalW} height={Math.max(1, height)}>
          {edges.map((edge) => {
            const look = EDGE_STYLE[edge.state];
            return (
              <Path
                key={edge.key}
                d={edge.d}
                stroke={look.stroke}
                strokeWidth={look.width}
                strokeDasharray={look.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            );
          })}
        </Svg>
      </Reveal>

      {[...placed.values()].map((p, i) => (
        <Reveal
          key={p.tie.id}
          from="right"
          delay={p.col * 110}
          index={i % 4}
          style={{ position: "absolute", left: x(p.col), top: ROUND_HEAD_H + p.top, width: cardW }}
        >
          <TieCard
            tie={p.tie}
            viewerId={viewerId}
            championId={championId}
            fixed
            compact={cardW < COMPACT_BELOW}
          />
        </Reveal>
      ))}
    </View>
  );

  return (
    <View onLayout={(e: LayoutChangeEvent) => setAvail(e.nativeEvent.layout.width)}>
      {scrolls ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
          {tree}
        </ScrollView>
      ) : (
        <View style={{ alignItems: "center" }}>{tree}</View>
      )}
    </View>
  );
}

// --- List (phones / tablets) ---------------------------------------------------------

/** The round worth opening on: the first with a tie to play, else the latest decided. */
export function defaultRoundIndex(rounds: BracketRound[]): number {
  const open = rounds.findIndex((round) => round.ties.some((tie) => tie.status === "open"));
  if (open >= 0) return open;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i].ties.some((tie) => tie.status === "decided")) return i;
  }
  return 0;
}

export function BracketList({
  rounds,
  viewerId,
  championId,
  roundMeta,
}: {
  rounds: BracketRound[];
  viewerId: string | null;
  championId: string | null;
  roundMeta?: (round: BracketRound) => string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const current = rounds.find((round) => round.key === picked) ?? rounds[defaultRoundIndex(rounds)];
  if (!current) return null;
  const meta = roundMeta?.(current);
  return (
    <View style={{ gap: spacing.md }}>
      {rounds.length > 1 ? (
        <Segmented
          options={rounds.map((round) => ({ value: round.key, label: round.shortLabel }))}
          value={current.key}
          onChange={setPicked}
          size="sm"
        />
      ) : null}
      <View style={styles.listHead}>
        <Txt variant="head" size={12} color={colors.textDim} style={styles.eyebrow}>
          {current.label.toUpperCase()}
        </Txt>
        {meta ? (
          <Txt size={11.5} color={colors.textFaint}>
            {meta}
          </Txt>
        ) : null}
      </View>
      {/* Tablets fit two ties per row; phones stack them. */}
      <Grid min={300} maxColumns={2} gap={spacing.md}>
        {current.ties.map((tie, i) => (
          <Reveal key={`${current.key}:${tie.id}`} index={i}>
            <TieCard tie={tie} viewerId={viewerId} championId={championId} />
          </Reveal>
        ))}
      </Grid>
    </View>
  );
}

// --- Tie card ------------------------------------------------------------------------

const LIVE: CSSAnimationKeyframes = {
  from: { opacity: 1 },
  to: { opacity: 0.3 },
};

function LiveDot() {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.accent,
        ...(reduced
          ? null
          : {
              animationName: LIVE,
              animationDuration: 900,
              animationIterationCount: "infinite",
              animationDirection: "alternate",
              animationTimingFunction: "ease-in-out",
            }),
      }}
    />
  );
}

function StatusChip({ tie, compact }: { tie: BracketTie; compact: boolean }) {
  if (tie.status === "open") {
    return (
      <View style={[styles.chip, styles.chipOpen]}>
        <LiveDot />
        <Txt variant="head" size={9.5} color={colors.accent} style={styles.chipText}>
          {compact ? "READY" : "READY TO PLAY"}
        </Txt>
      </View>
    );
  }
  if (tie.status === "decided") {
    return (
      <View style={styles.chip}>
        <Txt variant="head" size={9.5} color={colors.textDim} style={styles.chipText}>
          {tie.result ?? "DECIDED"}
        </Txt>
      </View>
    );
  }
  return (
    <Txt variant="head" size={9.5} color={colors.textFaint} style={styles.chipText}>
      AWAITING
    </Txt>
  );
}

/** "Sam Whitfield" → "Sam W." for compact cards. */
function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]}.` : first;
}

function SideRow({
  tie,
  index,
  viewerId,
  fixed,
  compact,
}: {
  tie: BracketTie;
  index: 0 | 1;
  viewerId: string | null;
  fixed: boolean;
  compact: boolean;
}) {
  const side = tie.sides[index];
  const decided = tie.status === "decided";
  const won = decided && side.id !== null && side.id === tie.winnerId;
  const lost = decided && !won;
  const crowned = won && !!tie.final;
  const isViewer = !!viewerId && side.id === viewerId;
  return (
    <View
      style={[
        styles.row,
        fixed && { height: ROW_H },
        index === 1 && styles.rowDivider,
        lost && { opacity: 0.5 },
      ]}
    >
      {side.player ? (
        <Avatar player={side.player} size={26} champion={crowned} />
      ) : (
        <View style={styles.ghost} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameLine}>
          {side.seed != null ? (
            <Txt variant="monoBold" size={11} color={colors.accent}>
              #{side.seed}
            </Txt>
          ) : null}
          <Txt
            variant={won ? "head" : "bodyMedium"}
            size={13.5}
            color={side.player ? colors.text : colors.textDim}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {side.player
              ? compact
                ? shortName(side.player.name)
                : side.player.name
              : side.placeholder}
          </Txt>
          {isViewer ? <Tag tone="accent">YOU</Tag> : null}
        </View>
        {side.sub ? (
          <Txt size={10.5} color={colors.textFaint} numberOfLines={1} style={{ marginTop: 1 }}>
            {side.sub}
          </Txt>
        ) : null}
      </View>
      {won ? (
        <Icon
          name={crowned ? "trophy" : "check"}
          size={14}
          stroke={2.5}
          color={crowned ? colors.gold : colors.win}
        />
      ) : null}
    </View>
  );
}

/**
 * Two-row tie card. `fixed` pins every part to the tree's geometry; the list view lets
 * rows size naturally.
 */
export function TieCard({
  tie,
  viewerId,
  championId,
  fixed = false,
  compact = false,
}: {
  tie: BracketTie;
  viewerId: string | null;
  championId: string | null;
  fixed?: boolean;
  /** Shorten names and the status chip for narrow tree columns. */
  compact?: boolean;
}) {
  const mine = !!viewerId && tie.sides.some((side) => side.id === viewerId);
  const titleWon = !!tie.final && tie.status === "decided" && !!championId;
  const borderColor = titleWon
    ? withAlpha(colors.gold, 0.6)
    : mine
      ? withAlpha(colors.accent, 0.7)
      : tie.status === "open"
        ? withAlpha(colors.accent, 0.3)
        : colors.line;

  const body = (
    <>
      <View style={[styles.header, fixed && { height: HEADER_H }]}>
        <Txt
          variant="head"
          size={10.5}
          color={titleWon ? colors.gold : colors.textDim}
          style={[styles.eyebrow, { flexShrink: 1 }]}
          numberOfLines={1}
        >
          {tie.label.toUpperCase()}
        </Txt>
        <StatusChip tie={tie} compact={compact} />
      </View>
      <SideRow tie={tie} index={0} viewerId={viewerId} fixed={fixed} compact={compact} />
      <SideRow tie={tie} index={1} viewerId={viewerId} fixed={fixed} compact={compact} />
      {tie.footer ? (
        <View style={[styles.footer, fixed && { height: FOOTER_H }]}>{tie.footer}</View>
      ) : null}
    </>
  );

  if (tie.onPress && !tie.footer) {
    return (
      <Interactive
        onPress={tie.onPress}
        accessibilityRole="link"
        accessibilityLabel={`${tie.label}: ${tie.sides
          .map((side) => side.player?.name ?? side.placeholder)
          .join(" v ")}`}
        pressScale={0.99}
        style={[styles.card, { borderColor }]}
        hoverStyle={{ backgroundColor: colors.surface2 }}
      >
        {body}
      </Interactive>
    );
  }
  return <View style={[styles.card, { borderColor }]}>{body}</View>;
}

// --- Skeleton ------------------------------------------------------------------------

function SkeletonTie() {
  return (
    <View style={[styles.card, { padding: spacing.md, gap: spacing.md }]}>
      <Skeleton width="40%" height={9} />
      {[0, 1].map((i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Skeleton width={26} height={26} round={13} />
          <Skeleton width="55%" height={11} />
        </View>
      ))}
    </View>
  );
}

/** Bracket-shaped placeholder: columns on desktop, a switcher + two cards on phones. */
export function BracketSkeleton({ columns = 3 }: { columns?: number }) {
  const { isDesktop } = useBreakpoint();
  if (!isDesktop) {
    return (
      <View
        style={{ gap: spacing.md }}
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
      >
        <Skeleton height={40} round={radius.md} />
        <SkeletonTie />
        <SkeletonTie />
      </View>
    );
  }
  return (
    <View
      style={{ flexDirection: "row", gap: COL_GAP_MIN }}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: columns }, (_, col) => (
        <View key={col} style={{ flex: 1, gap: V_GAP, justifyContent: "center" }}>
          <Skeleton width="50%" height={10} style={{ marginBottom: spacing.sm }} />
          {Array.from({ length: Math.max(1, 2 ** (columns - 1 - col)) }, (_, i) => (
            <SkeletonTie key={i} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.md },
  roundHead: { position: "absolute", top: 0 },
  eyebrow: { letterSpacing: 1.2 },
  listHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    paddingHorizontal: 2,
  },
  card: {
    borderWidth: BORDER,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  header: {
    minHeight: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
  },
  chipOpen: { backgroundColor: withAlpha(colors.accent, 0.12) },
  chipText: { letterSpacing: 0.8 },
  row: {
    minHeight: ROW_H,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  ghost: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
  },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  footer: {
    minHeight: FOOTER_H,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
});
