/**
 * Gold champion moment for a decided Grand Final / cup final: trophy over a pulsing ring,
 * the champion's avatar and name, a line of context, and count-up stats. A confetti burst
 * fires the first time each user sees each champion — the "seen" flag lives in
 * AsyncStorage (localStorage on web), so a refresh or revisit stays calm.
 */
import { useEffect, useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Confetti, CountUp, PulseRing, Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import type { Player } from "@/types";

const SEEN_PREFIX = "officefc.championSeen:";

export interface ChampionStat {
  label: string;
  value: number;
  /** Render the tweened number (e.g. "#4"). */
  format?: (n: number) => string;
}

/** True once per (user, champion) key: reads then sets the flag, so it fires a single time. */
function useFirstSighting(seenKey: string | null): boolean {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    if (!seenKey) return;
    let cancelled = false;
    const key = SEEN_PREFIX + seenKey;
    AsyncStorage.getItem(key)
      .then((seen) => {
        if (cancelled || seen) return;
        setFirst(true);
        return AsyncStorage.setItem(key, "1");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seenKey]);
  return first;
}

export function ChampionHero({
  kicker,
  player,
  fallbackName,
  line,
  stats = [],
  seenKey,
}: {
  /** Eyebrow, e.g. "GRAND FINAL CHAMPION · AUTUMN LEAGUE". */
  kicker: string;
  player: Player | null | undefined;
  /** Shown when the champion isn't on the roster any more. */
  fallbackName: string;
  /** One line of context, e.g. "Beat Priya in the Grand Final · after extra time". */
  line?: string;
  stats?: ChampionStat[];
  /** Stable per user + champion; null disables the celebration (e.g. signed-out). */
  seenKey: string | null;
}) {
  const { isTablet } = useBreakpoint();
  const celebrate = useFirstSighting(seenKey);
  const name = player?.name ?? fallbackName;
  const glowId = `champion-glow-${useId().replace(/:/g, "")}`;

  return (
    // The confetti sits outside the clipped card so it can fly over the page; zIndex keeps
    // later siblings (react-native-web Views are all position: relative) from covering it.
    <View style={styles.wrap}>
      <Reveal from="scale" style={[styles.card, webStyle({ boxShadow: GOLD_GLOW })]}>
        {/* Soft gold glow from behind the trophy. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={glowId} cx="50%" cy="0%" rx="70%" ry="90%">
              <Stop offset="0" stopColor={colors.gold} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.gold} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${glowId})`} />
        </Svg>

        <View style={[styles.body, isTablet && styles.bodyWide]}>
          <View style={styles.medallion}>
            <PulseRing size={84} color={colors.gold} />
            <View style={styles.trophyDisc}>
              <Icon name="trophy" size={34} color={colors.gold} stroke={2.2} />
            </View>
          </View>

          <View style={[styles.copy, isTablet && styles.copyWide]}>
            <Txt
              variant="head"
              size={10.5}
              color={colors.gold}
              style={[styles.kicker, !isTablet && styles.centerText]}
            >
              {kicker}
            </Txt>
            <View style={[styles.nameRow, !isTablet && { justifyContent: "center" }]}>
              <Avatar player={player} size={isTablet ? 44 : 40} champion />
              <Txt
                variant="head"
                size={isTablet ? 30 : 26}
                numberOfLines={1}
                style={{ flexShrink: 1, letterSpacing: -0.4 }}
                accessibilityRole="header"
              >
                {name}
              </Txt>
            </View>
            {line ? (
              <Txt
                size={13}
                color={colors.textDim}
                style={[{ marginTop: spacing.sm, lineHeight: 19 }, !isTablet && styles.centerText]}
              >
                {line}
              </Txt>
            ) : null}
          </View>

          {stats.length ? (
            <View style={[styles.stats, !isTablet && { justifyContent: "center" }]}>
              {stats.map((stat, i) => (
                <Reveal key={stat.label} index={i} delay={220} style={styles.stat}>
                  <CountUp
                    value={stat.value}
                    from={0}
                    duration={1100}
                    format={stat.format}
                    variant="monoBold"
                    size={26}
                    color={colors.gold}
                  />
                  <Txt variant="head" size={9.5} color={colors.textDim} style={styles.statLabel}>
                    {stat.label.toUpperCase()}
                  </Txt>
                </Reveal>
              ))}
            </View>
          ) : null}
        </View>
      </Reveal>
      {celebrate ? <Confetti count={36} spread={200} originY="35%" /> : null}
    </View>
  );
}

const GOLD_GLOW = `0 0 0 1px ${withAlpha(colors.gold, 0.25)}, 0 18px 48px ${withAlpha(colors.gold, 0.12)}`;

const styles = StyleSheet.create({
  wrap: { zIndex: 2 },
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.45),
    borderRadius: radius.xl,
    backgroundColor: mix(colors.surface, colors.gold, 5),
  },
  body: {
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.lg,
  },
  bodyWide: {
    flexDirection: "row",
    gap: spacing.x2,
    paddingHorizontal: spacing.x2,
  },
  medallion: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  trophyDisc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.5),
    backgroundColor: withAlpha(colors.gold, 0.1),
  },
  copy: { alignSelf: "stretch", minWidth: 0 },
  copyWide: { flex: 1, alignSelf: "center" },
  kicker: { letterSpacing: 1.4 },
  centerText: { textAlign: "center" },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: {
    minWidth: 84,
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.25),
    backgroundColor: withAlpha(colors.bg, 0.35),
  },
  statLabel: { letterSpacing: 1, marginTop: 2 },
});
