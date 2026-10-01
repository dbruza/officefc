/**
 * Silverware podium — trophy over the champion, silver/bronze medal blocks beside.
 *
 * On mount the blocks rise in reverse order (3rd, 2nd, then 1st) and the trophy drops
 * onto the top step last, so the reveal builds to the winner. Renders with one to three
 * entries: missing places keep an empty slot so gold always sits in the middle.
 */
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { EASE_OUT } from "./motion";
import { Txt } from "./Txt";
import { colors } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import type { Player } from "@/types";

export const MEDAL: Record<number, { color: string; label: string; icon: IconName }> = {
  1: { color: colors.gold, label: "Champion", icon: "trophy" },
  2: { color: colors.silver, label: "Runner-up", icon: "medal" },
  3: { color: colors.bronze, label: "Third", icon: "medal" },
};

export interface PodiumEntry {
  player: Player;
  elo: number;
}

const BLOCK_HEIGHT: Record<number, number> = { 1: 92, 2: 64, 3: 48 };
const ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

/** Entrance order: third rises first, the champion last, then the trophy lands. */
const RISE_DELAY: Record<number, number> = { 3: 0, 2: 170, 1: 340 };
const TROPHY_DELAY = 820;

// Module-level keyframes so each set registers once.
const RISE: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 26 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const GROW_UP: CSSAnimationKeyframes = {
  from: { transform: [{ scaleY: 0 }] },
  to: { transform: [{ scaleY: 1 }] },
};
const DROP: CSSAnimationKeyframes = {
  "0%": { opacity: 0, transform: [{ translateY: -28 }, { scale: 0.6 }] },
  "65%": { opacity: 1, transform: [{ translateY: 3 }, { scale: 1.12 }] },
  "100%": { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};

/** `entries` is the top three (or fewer) in rank order; renders silver–gold–bronze. */
export function Podium({
  entries,
  onPick,
}: {
  entries: PodiumEntry[];
  onPick?: (playerId: string) => void;
}) {
  // One id per mounted podium: tab screens stay mounted on web, so a fixed gradient id
  // would collide across podiums and paint every block with the first one's fill.
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  if (entries.length === 0) return null;
  const lineup = [2, 1, 3].map((rank) => ({ rank, entry: entries[rank - 1] }));

  const anim = (keyframes: CSSAnimationKeyframes, delay: number, duration: number) =>
    reduced
      ? null
      : {
          animationName: keyframes,
          animationDuration: duration,
          animationDelay: delay,
          animationTimingFunction: EASE_OUT,
          animationFillMode: "backwards" as const,
        };

  return (
    <View style={styles.row}>
      {lineup.map(({ entry, rank }) => {
        if (!entry) return <View key={`empty-${rank}`} style={styles.slot} />;
        const medal = MEDAL[rank];
        const gradientId = `podium-${uid}-${rank}`;
        const label = `${entry.player.name}, ${ORDINAL[rank]}, ${entry.elo} ELO`;
        const body = (hovered: boolean) => (
          <>
            <View style={styles.trophySlot}>
              {rank === 1 ? (
                <Animated.View style={{ ...anim(DROP, TROPHY_DELAY, 620) }}>
                  <Icon name="trophy" size={22} color={medal.color} />
                </Animated.View>
              ) : null}
            </View>
            <Avatar player={entry.player} size={rank === 1 ? 54 : 44} ring jersey />
            <View style={styles.nameBlock}>
              <Txt
                variant="bodyMedium"
                size={12.5}
                numberOfLines={1}
                color={hovered ? colors.accent : colors.text}
              >
                {firstName(entry.player.name)}
              </Txt>
              <Txt variant="monoBold" size={11} color={colors.textDim}>
                {entry.elo}
              </Txt>
            </View>
            <Animated.View
              style={{
                ...styles.block,
                height: BLOCK_HEIGHT[rank],
                borderColor: withAlpha(medal.color, hovered ? 0.55 : 0.3),
                transformOrigin: "bottom",
                ...anim(GROW_UP, RISE_DELAY[rank] + 60, 560),
              }}
            >
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
                <Defs>
                  <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={mix(colors.surface2, medal.color, 20)} />
                    <Stop offset="1" stopColor={colors.surface} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
              </Svg>
              <Txt
                variant="monoBold"
                size={rank === 1 ? 26 : 20}
                color={medal.color}
                style={{ lineHeight: rank === 1 ? 26 : 20 }}
              >
                {rank}
              </Txt>
              <Icon name={medal.icon} size={15} color={medal.color} />
            </Animated.View>
          </>
        );
        return (
          <Animated.View
            key={entry.player.id}
            style={{ ...styles.slot, ...anim(RISE, RISE_DELAY[rank], 520) }}
          >
            {onPick ? (
              <Interactive
                onPress={() => onPick(entry.player.id)}
                accessibilityRole="link"
                accessibilityLabel={label}
                pressScale={0.98}
                style={styles.column}
              >
                {({ hovered }) => body(hovered)}
              </Interactive>
            ) : (
              <View style={styles.column} accessible accessibilityLabel={label}>
                {body(false)}
              </View>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  slot: { flex: 1, minWidth: 0 },
  column: {
    alignItems: "center",
    gap: 7,
  },
  trophySlot: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  nameBlock: {
    alignItems: "center",
    alignSelf: "stretch",
  },
  block: {
    alignSelf: "stretch",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
    alignItems: "center",
    gap: 4,
    paddingTop: 9,
  },
});
