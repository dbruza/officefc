/** A profile achievement tile — unlock state, accent icon, progress toward the goal. */
import { StyleSheet, View } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { EASE_OUT, staggerDelay } from "./motion";
import { colors, radius } from "@/theme";
import { withAlpha } from "@/lib/color";
import type { Achievement } from "@/lib/awards";

// The fill is laid out at its final width and scales in from the left edge, so one
// module-level keyframe set serves every percentage.
const FILL: CSSAnimationKeyframes = {
  from: { transform: [{ scaleX: 0 }] },
  to: { transform: [{ scaleX: 1 }] },
};

export function AchievementBadge({
  achievement,
  index = 0,
}: {
  achievement: Achievement;
  /** Position in the grid — staggers the progress-bar fill. */
  index?: number;
}) {
  const reduced = useReducedMotion();
  const locked = !achievement.unlocked;
  const label = `${achievement.name}: ${achievement.desc}. ${
    locked ? `${achievement.cur} of ${achievement.goal}` : "Unlocked"
  }`;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.card,
        locked
          ? { borderColor: colors.line }
          : {
              borderColor: withAlpha(achievement.accent, 0.35),
              backgroundColor: withAlpha(achievement.accent, 0.04),
            },
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.iconTile,
            locked
              ? { backgroundColor: colors.surface2, borderColor: colors.line }
              : {
                  backgroundColor: withAlpha(achievement.accent, 0.14),
                  borderColor: withAlpha(achievement.accent, 0.3),
                },
          ]}
        >
          <Icon
            name={achievement.icon}
            size={21}
            color={locked ? colors.textFaint : achievement.accent}
          />
        </View>
        {achievement.unlocked ? (
          <View style={[styles.check, { backgroundColor: achievement.accent }]}>
            <Icon name="check" size={13} stroke={3} color={colors.onAccent} />
          </View>
        ) : (
          <Txt variant="monoBold" size={11} color={colors.textDim}>
            {achievement.cur}/{achievement.goal}
          </Txt>
        )}
      </View>
      <View style={{ minWidth: 0 }}>
        <Txt
          variant="head"
          size={13.5}
          color={locked ? colors.textDim : colors.text}
          numberOfLines={1}
        >
          {achievement.name}
        </Txt>
        <Txt size={11} color={colors.textFaint} style={{ marginTop: 1 }}>
          {achievement.desc}
        </Txt>
      </View>
      {locked && !achievement.oneShot ? (
        <View style={styles.track}>
          {reduced ? (
            <View
              style={[
                styles.fill,
                { width: `${achievement.pct}%`, backgroundColor: achievement.accent },
              ]}
            />
          ) : (
            <Animated.View
              style={{
                ...StyleSheet.flatten(styles.fill),
                width: `${achievement.pct}%`,
                backgroundColor: achievement.accent,
                transformOrigin: "left",
                animationName: FILL,
                animationDuration: 700,
                animationDelay: staggerDelay(index, 200),
                animationTimingFunction: EASE_OUT,
                animationFillMode: "backwards",
              }}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 13,
    paddingHorizontal: 12,
    gap: 9,
    minWidth: 0,
    // Fill the grid cell so tiles in one row share a height (the track pins to the bottom).
    flexGrow: 1,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: 4,
    marginTop: "auto",
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    opacity: 0.75,
  },
});
