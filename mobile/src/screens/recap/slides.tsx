/**
 * The season-recap story's slides plus the shareable summary card. Each slide is a
 * self-contained composition sized for a ~9:16 card (≈340–460pt wide); entrance motion
 * and count-ups replay whenever a slide remounts. Colours come from tokens and the shared
 * award palette (AWARD_META) so the recap matches the Seasons screen's awards.
 */
import { useEffect, useState, type RefObject } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  Avatar,
  Confetti,
  CountUp,
  Icon,
  LineChart,
  PulseRing,
  Reveal,
  Tag,
  Txt,
  type ChartPoint,
  type IconName,
} from "@/components";
import type { BiggestUpsetRecap, LeaguePlayer, SeasonRecap } from "@/lib/league";
import { AWARD_META } from "@/lib/awards";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";

/** Rivalry has no award-palette entry, so it reads as "heat"; moments share the upset hue. */
export const RIVALRY_TINT = colors.loss;
export const MOMENT_TINT = AWARD_META.giant.accent;

// --- Shared bits ---------------------------------------------------------------------

function SlideHead({ kicker, title, tint }: { kicker: string; title: string; tint: string }) {
  return (
    <Reveal from="down" duration={360}>
      <Txt variant="head" size={10.5} color={tint} style={styles.kicker}>
        {kicker}
      </Txt>
      <Txt variant="head" size={26} style={styles.title} accessibilityRole="header">
        {title}
      </Txt>
    </Reveal>
  );
}

function PersonChip({
  label,
  player,
  icon,
  tint,
  compact = false,
}: {
  label: string;
  player: LeaguePlayer | undefined;
  icon: IconName;
  tint: string;
  /** Three-across on the share card: smaller avatar, tinted label instead of an icon. */
  compact?: boolean;
}) {
  if (!player) return null;
  return (
    <View style={[styles.personChip, compact && styles.personChipCompact]}>
      <Avatar player={player} size={compact ? 24 : 30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {!compact ? <Icon name={icon} size={11} color={tint} /> : null}
          <Txt
            variant="head"
            size={compact ? 8.5 : 9}
            color={compact ? tint : colors.textDim}
            style={styles.chipLabel}
            numberOfLines={1}
          >
            {label.toUpperCase()}
          </Txt>
        </View>
        <Txt variant="bodyMedium" size={compact ? 12 : 13} numberOfLines={1}>
          {firstName(player.name)}
        </Txt>
      </View>
    </View>
  );
}

// --- Champion ------------------------------------------------------------------------

export function ChampionSlide({
  seasonName,
  champion,
  runnerUp,
  premier,
  format,
  celebrate,
  onCelebrated,
}: {
  seasonName: string;
  champion: LeaguePlayer | undefined;
  runnerUp: LeaguePlayer | undefined;
  premier: LeaguePlayer | undefined;
  format: "table" | "finals";
  /** Burst confetti on this mount (the story shows it once per visit, not on every swipe back). */
  celebrate: boolean;
  onCelebrated: () => void;
}) {
  const double = format === "finals" && !!premier && premier.id === champion?.id;
  // Captured at mount so the burst plays out even after the parent clears the flag.
  const [burst] = useState(celebrate);
  // Mount-only on purpose: report the burst once, whatever the parent re-renders.
  useEffect(() => {
    if (burst) onCelebrated();
  }, []);
  return (
    <View style={styles.fill}>
      <SlideHead
        kicker={`${seasonName.toUpperCase()} · RECAP`}
        title="Your champion"
        tint={colors.gold}
      />
      <View style={styles.center}>
        <Reveal from="scale" delay={150} duration={520} style={styles.medallion}>
          <PulseRing size={150} color={colors.gold} />
          <View style={styles.championRing}>
            {champion ? (
              <Avatar player={champion} size={108} champion />
            ) : (
              <Icon name="trophy" size={52} color={colors.gold} />
            )}
          </View>
        </Reveal>
        <Reveal delay={380} style={{ alignItems: "center" }}>
          <Txt
            variant="head"
            size={11}
            color={colors.gold}
            style={[styles.kicker, { marginTop: spacing.lg }]}
          >
            {format === "finals" ? "GRAND FINAL WINNER" : "TOP OF THE TABLE"}
          </Txt>
          <Txt variant="head" size={32} style={styles.bigName} numberOfLines={2}>
            {champion?.name ?? "Champion"}
          </Txt>
          {double ? (
            <View style={{ marginTop: spacing.sm }}>
              <Tag tone="gold">THE DOUBLE</Tag>
            </View>
          ) : null}
        </Reveal>
      </View>
      <Reveal delay={560} style={styles.chipRow}>
        <PersonChip label="Runner-up" player={runnerUp} icon="medal" tint={colors.silver} />
        {format === "finals" && !double ? (
          <PersonChip label="Premier" player={premier} icon="crown" tint={colors.accent} />
        ) : null}
      </Reveal>
      {burst ? <Confetti count={40} spread={190} originY="38%" /> : null}
    </View>
  );
}

// --- Awards --------------------------------------------------------------------------

export interface AwardTile {
  key: string;
  icon: IconName;
  accent: string;
  label: string;
  player: LeaguePlayer;
  value: number;
  format?: (n: number) => string;
  unit: string;
}

/** The four personal awards, in a fixed order; absent or unresolvable ones are skipped. */
export function awardTiles(recap: SeasonRecap, players: Map<string, LeaguePlayer>): AwardTile[] {
  const tiles: AwardTile[] = [];
  const add = (tile: Omit<AwardTile, "player"> & { playerId: string }) => {
    const player = players.get(tile.playerId);
    if (player) tiles.push({ ...tile, player });
  };
  if (recap.goldenBoot) {
    add({
      key: "goldenBoot",
      playerId: recap.goldenBoot.playerId,
      icon: AWARD_META.boot.icon,
      accent: AWARD_META.boot.accent,
      label: "Golden Boot",
      value: recap.goldenBoot.goals,
      unit: "goals",
    });
  }
  if (recap.bestDefense) {
    add({
      key: "bestDefense",
      playerId: recap.bestDefense.playerId,
      icon: AWARD_META.glove.icon,
      accent: AWARD_META.glove.accent,
      label: "Golden Glove",
      value: recap.bestDefense.conceded,
      unit: "conceded",
    });
  }
  if (recap.mostImproved) {
    add({
      key: "mostImproved",
      playerId: recap.mostImproved.playerId,
      icon: AWARD_META.improved.icon,
      accent: AWARD_META.improved.accent,
      label: "Most Improved",
      value: recap.mostImproved.eloGain,
      format: signed,
      unit: "ELO climb",
    });
  }
  if (recap.longestWinStreak) {
    add({
      key: "longestWinStreak",
      playerId: recap.longestWinStreak.playerId,
      icon: AWARD_META.streak.icon,
      accent: AWARD_META.streak.accent,
      label: "Win Streak",
      value: recap.longestWinStreak.streak,
      unit: "in a row",
    });
  }
  return tiles;
}

export function AwardsSlide({ tiles }: { tiles: AwardTile[] }) {
  return (
    <View style={styles.fill}>
      <SlideHead kicker="THE SILVERWARE" title="Season awards" tint={colors.gold} />
      <View style={styles.awardGrid}>
        {tiles.map((tile, i) => (
          <Reveal key={tile.key} from="scale" index={i} delay={180} style={styles.awardTile}>
            <View
              style={[
                styles.awardIcon,
                {
                  backgroundColor: withAlpha(tile.accent, 0.14),
                  borderColor: withAlpha(tile.accent, 0.4),
                },
              ]}
            >
              <Icon name={tile.icon} size={18} color={tile.accent} />
            </View>
            <Txt variant="head" size={9.5} color={colors.textDim} style={styles.chipLabel}>
              {tile.label.toUpperCase()}
            </Txt>
            <CountUp
              value={tile.value}
              from={0}
              duration={1000}
              format={tile.format}
              variant="monoBold"
              size={34}
              color={tile.accent}
              style={{ lineHeight: 40 }}
            />
            <Txt size={11} color={colors.textFaint} style={{ marginTop: -2 }}>
              {tile.unit}
            </Txt>
            <View style={styles.awardWinner}>
              <Avatar player={tile.player} size={22} />
              <Txt variant="bodyMedium" size={12.5} numberOfLines={1} style={{ flexShrink: 1 }}>
                {firstName(tile.player.name)}
              </Txt>
            </View>
          </Reveal>
        ))}
      </View>
    </View>
  );
}

// --- Rivalry -------------------------------------------------------------------------

export function RivalrySlide({ a, b, games }: { a: LeaguePlayer; b: LeaguePlayer; games: number }) {
  return (
    <View style={styles.fill}>
      <SlideHead kicker="BIGGEST RIVALRY" title="Nobody met more" tint={RIVALRY_TINT} />
      <View style={styles.center}>
        <View style={styles.faceOff}>
          <Reveal from="right" delay={140} duration={520} style={styles.faceOffSide}>
            <Avatar player={a} size={84} />
            <Txt variant="head" size={16} style={{ marginTop: spacing.sm }} numberOfLines={1}>
              {firstName(a.name)}
            </Txt>
          </Reveal>
          <Reveal from="scale" delay={420}>
            <Txt variant="monoBold" size={18} color={RIVALRY_TINT}>
              VS
            </Txt>
          </Reveal>
          <Reveal from="left" delay={140} duration={520} style={styles.faceOffSide}>
            <Avatar player={b} size={84} />
            <Txt variant="head" size={16} style={{ marginTop: spacing.sm }} numberOfLines={1}>
              {firstName(b.name)}
            </Txt>
          </Reveal>
        </View>
        <Reveal delay={520} style={{ alignItems: "center", marginTop: spacing.x2 }}>
          <CountUp
            value={games}
            from={0}
            duration={1100}
            variant="monoBold"
            size={72}
            style={{ lineHeight: 80 }}
          />
          <Txt variant="head" size={12} color={colors.textDim} style={styles.kicker}>
            MEETINGS THIS SEASON
          </Txt>
        </Reveal>
      </View>
    </View>
  );
}

// --- Moments -------------------------------------------------------------------------

export interface GameMoment {
  a: LeaguePlayer;
  b: LeaguePlayer;
  aGoals: number;
  bGoals: number;
}

export interface UpsetMoment {
  winner: LeaguePlayer;
  loser: LeaguePlayer | undefined;
  upset: BiggestUpsetRecap;
}

export function MomentsSlide({ game, upset }: { game?: GameMoment; upset?: UpsetMoment }) {
  return (
    <View style={styles.fill}>
      <SlideHead
        kicker="MOMENTS"
        title={game ? "Game of the season" : "Shock of the season"}
        tint={MOMENT_TINT}
      />
      <View style={[styles.center, { gap: spacing.xl }]}>
        {game ? (
          <Reveal from="scale" delay={160} style={styles.scoreCard}>
            <View style={styles.scoreSide}>
              <Avatar player={game.a} size={52} />
              <Txt variant="bodyMedium" size={13} numberOfLines={1} style={{ marginTop: 6 }}>
                {firstName(game.a.name)}
              </Txt>
            </View>
            <View style={styles.scoreMid}>
              <CountUp value={game.aGoals} from={0} variant="monoBold" size={48} />
              <Txt variant="monoBold" size={32} color={colors.textFaint}>
                –
              </Txt>
              <CountUp value={game.bGoals} from={0} variant="monoBold" size={48} />
            </View>
            <View style={styles.scoreSide}>
              <Avatar player={game.b} size={52} />
              <Txt variant="bodyMedium" size={13} numberOfLines={1} style={{ marginTop: 6 }}>
                {firstName(game.b.name)}
              </Txt>
            </View>
          </Reveal>
        ) : null}
        {upset ? (
          <Reveal delay={game ? 520 : 160} style={styles.upsetCard}>
            <View style={styles.upsetHead}>
              <Icon name={AWARD_META.giant.icon} size={14} color={AWARD_META.giant.accent} />
              <Txt
                variant="head"
                size={10}
                color={AWARD_META.giant.accent}
                style={styles.chipLabel}
              >
                BIGGEST UPSET
              </Txt>
            </View>
            <View style={styles.upsetBody}>
              <Avatar player={upset.winner} size={36} />
              <Txt size={14} style={{ flex: 1, lineHeight: 20 }}>
                <Txt variant="head" size={14}>
                  {firstName(upset.winner.name)}
                </Txt>{" "}
                stunned {upset.loser ? firstName(upset.loser.name) : "the favourite"}
              </Txt>
              <Txt variant="monoBold" size={22} color={AWARD_META.giant.accent}>
                {upset.upset.winnerGoals}–{upset.upset.loserGoals}
              </Txt>
            </View>
          </Reveal>
        ) : null}
      </View>
    </View>
  );
}

// --- You -----------------------------------------------------------------------------

export interface YouData {
  rank: number | null;
  /** Ranked players in the final table. */
  of: number;
  w: number;
  d: number;
  l: number;
  eloStart: number;
  eloEnd: number;
  history: ChartPoint[];
  honours: string[];
}

export function YouSlide({ you }: { you: YouData }) {
  const delta = you.eloEnd - you.eloStart;
  return (
    <View style={styles.fill}>
      <SlideHead kicker="YOUR SEASON" title="How you did" tint={colors.accent} />
      <View style={styles.youBody}>
        <Reveal delay={140} style={styles.rankBlock}>
          {you.rank ? (
            <>
              <Txt size={13} color={colors.textDim}>
                You finished
              </Txt>
              <CountUp
                value={you.rank}
                from={Math.max(you.of, you.rank)}
                duration={1000}
                format={ordinal}
                variant="monoBold"
                size={64}
                color={you.rank <= 3 ? colors.gold : colors.text}
                style={{ lineHeight: 72 }}
              />
              <Txt size={13} color={colors.textDim}>
                of {you.of} on the table
              </Txt>
            </>
          ) : (
            <>
              <Txt variant="head" size={22}>
                Provisional
              </Txt>
              <Txt size={13} color={colors.textDim}>
                Not enough games for a ranked place
              </Txt>
            </>
          )}
        </Reveal>

        <Reveal delay={300} style={styles.wdl}>
          {(
            [
              ["W", you.w, colors.win],
              ["D", you.d, colors.draw],
              ["L", you.l, colors.loss],
            ] as const
          ).map(([label, value, tone]) => (
            <View key={label} style={styles.wdlTile}>
              <CountUp value={value} from={0} variant="monoBold" size={24} color={tone} />
              <Txt variant="head" size={9.5} color={colors.textDim} style={styles.chipLabel}>
                {label === "W" ? "WON" : label === "D" ? "DRAWN" : "LOST"}
              </Txt>
            </View>
          ))}
        </Reveal>

        <Reveal delay={440} style={styles.eloBlock}>
          <View style={styles.eloLine}>
            <Txt variant="head" size={10} color={colors.textDim} style={styles.chipLabel}>
              ELO
            </Txt>
            <CountUp
              value={you.eloEnd}
              from={you.eloStart}
              duration={1200}
              variant="monoBold"
              size={22}
            />
            <Txt
              variant="monoBold"
              size={13}
              color={delta > 0 ? colors.win : delta < 0 ? colors.loss : colors.textDim}
            >
              {signed(delta)}
            </Txt>
          </View>
          {you.history.length >= 2 ? <LineChart data={you.history} height={84} /> : null}
        </Reveal>

        {you.honours.length ? (
          <Reveal delay={600} style={styles.honours}>
            {you.honours.map((honour) => (
              <Tag key={honour} tone="gold">
                {honour.toUpperCase()}
              </Tag>
            ))}
          </Reveal>
        ) : null}
      </View>
    </View>
  );
}

// --- Share card ----------------------------------------------------------------------

/** One row of the share card; absent sections never produce a row. */
interface ShareRow {
  key: string;
  icon: IconName;
  accent: string;
  label: string;
  names: string;
  value: string;
  sub: string;
}

function shareRows(recap: SeasonRecap | null, players: Map<string, LeaguePlayer>): ShareRow[] {
  if (!recap) return [];
  const rows: ShareRow[] = awardTiles(recap, players).map((tile) => ({
    key: tile.key,
    icon: tile.icon,
    accent: tile.accent,
    label: tile.label,
    names: firstName(tile.player.name),
    value: tile.format ? tile.format(tile.value) : String(tile.value),
    sub: tile.unit,
  }));
  const name = (uid: string) => players.get(uid);
  if (recap.biggestRivalry) {
    // Both names must resolve or neither renders — half a rivalry is worse than none.
    const a = name(recap.biggestRivalry.aId);
    const b = name(recap.biggestRivalry.bId);
    if (a && b) {
      rows.push({
        key: "biggestRivalry",
        icon: "swords",
        accent: RIVALRY_TINT,
        label: "Biggest Rivalry",
        names: `${firstName(a.name)} × ${firstName(b.name)}`,
        value: String(recap.biggestRivalry.games),
        sub: "meetings",
      });
    }
  }
  if (recap.gameOfTheSeason) {
    const game = recap.gameOfTheSeason;
    const a = name(game.aId);
    const b = name(game.bId);
    if (a && b) {
      rows.push({
        key: "gameOfTheSeason",
        icon: "ball",
        accent: MOMENT_TINT,
        label: "Game of the Season",
        names: `${firstName(a.name)} × ${firstName(b.name)}`,
        value: `${game.aGoals}-${game.bGoals}`,
        sub: "final score",
      });
    }
  }
  if (recap.biggestUpset) {
    const upset = recap.biggestUpset;
    const winner = name(upset.winnerId);
    if (winner) {
      rows.push({
        key: "biggestUpset",
        icon: AWARD_META.giant.icon,
        accent: AWARD_META.giant.accent,
        label: "Biggest Upset",
        names: firstName(winner.name),
        value: `${upset.winnerGoals}-${upset.loserGoals}`,
        sub: `over ${firstName(name(upset.loserId)?.name ?? "the table")}`,
      });
    }
  }
  return rows;
}

/**
 * The capturable summary. Rendered on an opaque root: a transparent root bakes the OS
 * window colour (or a checkerboard) into the exported PNG instead of the card's surface.
 */
export function ShareCard({
  cardRef,
  seasonName,
  champion,
  runnerUp,
  premier,
  format,
  recap,
  players,
}: {
  cardRef: RefObject<View | null>;
  seasonName: string;
  champion: LeaguePlayer | undefined;
  runnerUp: LeaguePlayer | undefined;
  premier: LeaguePlayer | undefined;
  format: "table" | "finals";
  recap: SeasonRecap | null;
  players: Map<string, LeaguePlayer>;
}) {
  const rows = shareRows(recap, players);
  return (
    <ScrollView style={styles.fill} showsVerticalScrollIndicator={false}>
      <SlideHead kicker="SHARE" title="Your season card" tint={colors.accent} />
      <Reveal from="scale" delay={120}>
        <View ref={cardRef} collapsable={false} style={styles.captureRoot}>
          <View style={styles.shareCard}>
            <Txt variant="head" size={10} color={colors.accent} style={styles.kicker}>
              ● OFFICEFC · SEASON RECAP
            </Txt>
            <Txt variant="head" size={22} style={{ marginTop: 2 }} numberOfLines={1}>
              {seasonName}
            </Txt>
            {/* Champion gets the full row; the other honours pair up beneath it. */}
            <View style={styles.shareChips}>
              <View style={styles.shareChipPair}>
                <PersonChip label="Champion" player={champion} icon="trophy" tint={colors.gold} />
              </View>
              <View style={styles.shareChipPair}>
                {format === "finals" && premier ? (
                  <PersonChip
                    label="Premier"
                    player={premier}
                    icon="crown"
                    tint={colors.accent}
                    compact
                  />
                ) : null}
                <PersonChip
                  label="Runner-up"
                  player={runnerUp}
                  icon="medal"
                  tint={colors.silver}
                  compact
                />
              </View>
            </View>
            {rows.length ? (
              <View style={{ gap: 6, marginTop: spacing.md }}>
                {rows.map((row) => (
                  <View key={row.key} style={styles.shareRow}>
                    <View
                      style={[styles.shareRowIcon, { borderColor: withAlpha(row.accent, 0.45) }]}
                    >
                      <Icon name={row.icon} size={12} color={row.accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt
                        variant="head"
                        size={8.5}
                        color={colors.textDim}
                        style={styles.chipLabel}
                      >
                        {row.label.toUpperCase()}
                      </Txt>
                      <Txt variant="bodyMedium" size={12} numberOfLines={1}>
                        {row.names}{" "}
                        <Txt variant="mono" size={10.5} color={colors.textFaint}>
                          {row.sub}
                        </Txt>
                      </Txt>
                    </View>
                    <Txt variant="monoBold" size={15} color={row.accent}>
                      {row.value}
                    </Txt>
                  </View>
                ))}
              </View>
            ) : (
              <Txt size={12} color={colors.textDim} style={{ marginTop: spacing.md }}>
                No award facts were recorded for this season.
              </Txt>
            )}
          </View>
        </View>
      </Reveal>
    </ScrollView>
  );
}

// --- Helpers -------------------------------------------------------------------------

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: { letterSpacing: 1.4 },
  title: { marginTop: 4, letterSpacing: -0.4 },
  chipLabel: { letterSpacing: 1.1 },
  bigName: { textAlign: "center", marginTop: 2, letterSpacing: -0.5 },
  medallion: { width: 150, height: 150, alignItems: "center", justifyContent: "center" },
  championRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.5),
    backgroundColor: withAlpha(colors.gold, 0.08),
  },
  chipRow: { flexDirection: "row", gap: spacing.sm },
  personChipCompact: { gap: 6, padding: 6 },
  personChip: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.bg, 0.5),
  },
  awardGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    gap: spacing.sm,
  },
  awardTile: {
    width: "48%",
    flexGrow: 1,
    gap: 4,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.bg, 0.45),
  },
  awardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  awardWinner: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  faceOff: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  faceOffSide: { alignItems: "center", width: 112 },
  scoreCard: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(MOMENT_TINT, 0.3),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.bg, 0.45),
  },
  scoreSide: { flex: 1, alignItems: "center", minWidth: 0 },
  scoreMid: { flexDirection: "row", alignItems: "center", gap: 6 },
  upsetCard: {
    alignSelf: "stretch",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(AWARD_META.giant.accent, 0.35),
    borderRadius: radius.lg,
    backgroundColor: withAlpha(colors.bg, 0.45),
  },
  upsetHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  upsetBody: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  youBody: { flex: 1, justifyContent: "center", paddingBottom: spacing.x2 },
  rankBlock: { alignItems: "center" },
  wdl: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  wdlTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.bg, 0.45),
  },
  eloBlock: { marginTop: spacing.lg, gap: spacing.xs },
  eloLine: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  honours: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.md },
  captureRoot: {
    marginTop: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
  },
  shareCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  shareChips: { gap: 6, marginTop: spacing.md },
  shareChipPair: { flexDirection: "row", gap: 6 },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  shareRowIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
});
