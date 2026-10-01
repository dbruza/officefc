/**
 * Motion primitives. Entrances use Reanimated 4 CSS animations (real CSS keyframes on
 * web, the UI thread on native) so they cost nothing on the JS thread. Everything
 * collapses to a static render when the OS asks for reduced motion.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cubicBezier,
  useReducedMotion,
  type CSSAnimationKeyframes,
} from "react-native-reanimated";
import { Txt, type TxtProps } from "./Txt";
import { colors, motion, radius } from "@/theme";

// Reanimated's style typings reject its own CubicBezierEasing (the runtime accepts it and
// emits a real cubic-bezier() on web), so expose the curves under a predefined-name type.
type TimingFunction = "ease-out";
export const EASE_OUT = cubicBezier(0.22, 1, 0.36, 1) as unknown as TimingFunction;
export const EASE_SPRING = cubicBezier(0.34, 1.56, 0.64, 1) as unknown as TimingFunction;

type Direction = "up" | "down" | "left" | "right" | "scale" | "fade";

// Module-level so each keyframe set is registered once, not per render.
const KEYFRAMES: Record<Direction, CSSAnimationKeyframes> = {
  up: {
    from: { opacity: 0, transform: [{ translateY: 12 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  down: {
    from: { opacity: 0, transform: [{ translateY: -12 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  left: {
    from: { opacity: 0, transform: [{ translateX: 16 }] },
    to: { opacity: 1, transform: [{ translateX: 0 }] },
  },
  right: {
    from: { opacity: 0, transform: [{ translateX: -16 }] },
    to: { opacity: 1, transform: [{ translateX: 0 }] },
  },
  scale: {
    from: { opacity: 0, transform: [{ scale: 0.94 }] },
    to: { opacity: 1, transform: [{ scale: 1 }] },
  },
  fade: {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
};

/** Stagger delay for the `index`-th item of a list, capped so long lists settle fast. */
export function staggerDelay(index: number, base = 0): number {
  return base + Math.min(index * motion.stagger, motion.staggerMax);
}

export interface RevealProps {
  children: ReactNode;
  /** Entrance direction. `up` (rise + fade) is the default for content blocks. */
  from?: Direction;
  /** Position in a list — adds a capped stagger delay. */
  index?: number;
  /** Extra delay in ms (added to any stagger). */
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Plays a one-shot entrance when mounted. Wrap blocks that appear after data loads
 * (tab screens stay mounted, so this runs once per session, not on every tab switch).
 */
export function Reveal({
  children,
  from = "up",
  index,
  delay = 0,
  duration = motion.slow,
  style,
}: RevealProps) {
  const reduced = useReducedMotion();
  if (reduced) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      style={{
        // Reanimated's CSS props only type-check on a single object, so flatten.
        ...StyleSheet.flatten(style),
        animationName: KEYFRAMES[from],
        animationDuration: duration,
        animationDelay: index != null ? staggerDelay(index, delay) : delay,
        animationTimingFunction: EASE_OUT,
        animationFillMode: "backwards",
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Tween a number toward `value` (ease-out cubic). The first render shows `from` (or
 * `value` when omitted, i.e. no entrance tween); later changes tween from the last
 * displayed number, so an ELO update visibly ticks to its new value.
 */
export function useCountUp(value: number, { from, duration = 900 } = {} as CountUpOptions) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(() => (reduced ? value : (from ?? value)));
  const current = useRef(display);

  useEffect(() => {
    const start = current.current;
    const delta = value - start;
    if (reduced || delta === 0) {
      current.current = value;
      setDisplay(value);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(start + delta * eased);
      current.current = next;
      setDisplay(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return display;
}

interface CountUpOptions {
  from?: number;
  duration?: number;
}

/** `<Txt>` that ticks its number toward `value`. Accepts every Txt prop. */
export function CountUp({
  value,
  from,
  duration,
  format,
  ...txt
}: Omit<TxtProps, "children"> & {
  value: number;
  from?: number;
  duration?: number;
  /** Render the tweened number (e.g. add a sign or unit). */
  format?: (n: number) => string;
}) {
  const n = useCountUp(value, { from, duration });
  return <Txt {...txt}>{format ? format(n) : n}</Txt>;
}

const PULSE: CSSAnimationKeyframes = {
  from: { opacity: 0.45 },
  to: { opacity: 0.9 },
};

/** Placeholder block with a soft pulse. Size it like the content it stands in for. */
export function Skeleton({
  width = "100%",
  height = 14,
  round = radius.sm,
  style,
}: {
  width?: ViewStyle["width"];
  height?: number;
  round?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: round, backgroundColor: colors.surface2 },
        reduced
          ? { opacity: 0.7 }
          : {
              animationName: PULSE,
              animationDuration: 900,
              animationIterationCount: "infinite",
              animationDirection: "alternate",
              animationTimingFunction: "ease-in-out",
            },
        style,
      ]}
    />
  );
}

/** A stack of row-shaped skeletons (avatar + two lines + trailing number). */
export function SkeletonRows({ count = 4, height = 60 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: 8 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            height,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
            opacity: 1 - i * (0.6 / Math.max(count, 1)),
          }}
        >
          <Skeleton width={36} height={36} round={18} />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton width="45%" height={11} />
            <Skeleton width="28%" height={9} />
          </View>
          <Skeleton width={44} height={16} />
        </View>
      ))}
    </View>
  );
}

/** Card-shaped skeleton for hero / summary blocks. */
export function SkeletonCard({ height = 140 }: { height?: number }) {
  return (
    <View
      style={{
        height,
        padding: 16,
        gap: 10,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <Skeleton width="30%" height={10} />
      <Skeleton width="45%" height={30} />
      <Skeleton width="60%" height={10} />
    </View>
  );
}

const CONFETTI_COLORS = [colors.accent, colors.gold, "#ffffff", colors.win, "#7cc8ff"];

interface ConfettiPiece {
  keyframes: CSSAnimationKeyframes;
  color: string;
  width: number;
  height: number;
  delay: number;
  duration: number;
}

function makeConfetti(count: number, spread: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const power = spread * (0.45 + Math.random() * 0.55);
    const dx = Math.cos(angle) * power;
    const rise = -Math.abs(Math.sin(angle) * power) - 40;
    const spin = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360);
    return {
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      width: 6 + Math.random() * 4,
      height: 9 + Math.random() * 6,
      delay: Math.random() * 120,
      duration: 1100 + Math.random() * 600,
      keyframes: {
        "0%": {
          opacity: 1,
          transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: "0deg" }, { scale: 0.6 }],
        },
        "35%": {
          opacity: 1,
          transform: [
            { translateX: dx * 0.75 },
            { translateY: rise },
            { rotate: `${spin * 0.4}deg` },
            { scale: 1 },
          ],
        },
        "100%": {
          opacity: 0,
          transform: [
            { translateX: dx },
            { translateY: rise + spread * 1.1 },
            { rotate: `${spin}deg` },
            { scale: 0.9 },
          ],
        },
      },
    };
  });
}

/**
 * One-shot confetti burst from the centre of its parent (absolutely positioned, ignores
 * touches). Remount with a new `key` to fire again. Skipped under reduced motion.
 */
export function Confetti({
  count = 28,
  spread = 160,
  originY = "40%",
}: {
  count?: number;
  spread?: number;
  originY?: ViewStyle["top"];
}) {
  const reduced = useReducedMotion();
  const [pieces] = useState(() => makeConfetti(count, spread));
  if (reduced) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "visible" }}
    >
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: "50%",
            top: originY,
            width: p.width,
            height: p.height,
            borderRadius: 2,
            backgroundColor: p.color,
            animationName: p.keyframes,
            animationDuration: p.duration,
            animationDelay: p.delay,
            animationTimingFunction: "ease-out",
            animationFillMode: "both",
          }}
        />
      ))}
    </View>
  );
}

const GLOW: CSSAnimationKeyframes = {
  from: { opacity: 0.35, transform: [{ scale: 0.92 }] },
  to: { opacity: 0, transform: [{ scale: 1.6 }] },
};

/** Expanding ring pulse behind a hero element (success check, champion trophy). */
export function PulseRing({ size, color = colors.accent }: { size: number; color?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        animationName: GLOW,
        animationDuration: 1400,
        animationIterationCount: "infinite",
        animationTimingFunction: "ease-out",
      }}
    />
  );
}
