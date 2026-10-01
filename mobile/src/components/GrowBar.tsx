/**
 * Horizontal bar whose fill grows in from one edge on mount (analytics rates, head-to-head
 * tale-of-the-tape bars). The target width is a plain percentage on a wrapper; a
 * module-level keyframe wipes the inner fill from 0% → 100% of that wrapper, so every
 * bar shares one registered animation whatever its value. Changing `value` re-keys the
 * fill so the bar regrows to its new length. `ShareBar` is the stacked (W/D/L) variant.
 */
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import { EASE_OUT } from "./motion";
import { colors } from "@/theme";

const GROW: CSSAnimationKeyframes = {
  from: { width: "0%" },
  to: { width: "100%" },
};

export function GrowBar({
  value,
  color = colors.accent,
  height = 8,
  from = "left",
  delay = 0,
  duration = 700,
  track = colors.surface2,
  style,
}: {
  /** Fill fraction, clamped to 0–1. */
  value: number;
  color?: string;
  height?: number;
  /** Edge the fill grows from — "right" for the left half of a mirrored pair. */
  from?: "left" | "right";
  delay?: number;
  duration?: number;
  /** Unfilled track colour; pass "transparent" for bare bars. */
  track?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const pct = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 1000) / 10;
  const justify = from === "right" ? "flex-end" : "flex-start";
  const round = height / 2;
  return (
    <View
      style={[
        {
          height,
          borderRadius: round,
          backgroundColor: track,
          overflow: "hidden",
          flexDirection: "row",
          justifyContent: justify,
        },
        style,
      ]}
    >
      <View style={{ width: `${pct}%`, height, flexDirection: "row", justifyContent: justify }}>
        <Animated.View
          key={pct}
          style={{
            width: "100%",
            height,
            borderRadius: round,
            backgroundColor: color,
            ...(reduced
              ? null
              : {
                  animationName: GROW,
                  animationDuration: duration,
                  animationDelay: delay,
                  animationTimingFunction: EASE_OUT,
                  animationFillMode: "backwards",
                }),
          }}
        />
      </View>
    </View>
  );
}

/**
 * Stacked share bar (e.g. wins / draws / losses) that wipes in from the left. Segments
 * keep their proportions while the whole bar grows; zero-value parts are skipped.
 */
export function ShareBar({
  parts,
  height = 10,
  gap = 2,
  delay = 0,
  duration = 800,
  style,
}: {
  parts: Array<{ key: string; value: number; color: string }>;
  height?: number;
  gap?: number;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const visible = parts.filter((part) => part.value > 0);
  const signature = visible.map((part) => `${part.key}:${part.value}`).join("|");
  return (
    <View
      style={[
        { height, borderRadius: height / 2, overflow: "hidden", backgroundColor: colors.surface2 },
        style,
      ]}
    >
      <Animated.View
        key={signature}
        style={{
          height,
          width: "100%",
          flexDirection: "row",
          gap,
          overflow: "hidden",
          ...(reduced
            ? null
            : {
                animationName: GROW,
                animationDuration: duration,
                animationDelay: delay,
                animationTimingFunction: EASE_OUT,
                animationFillMode: "backwards",
              }),
        }}
      >
        {visible.map((part) => (
          <View key={part.key} style={{ flex: part.value, backgroundColor: part.color }} />
        ))}
      </Animated.View>
    </View>
  );
}
