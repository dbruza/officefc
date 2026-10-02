/**
 * ELO-over-time line chart (react-native-svg), ported from the prototype.
 *
 * The chart measures its container and draws at the real pixel width: the old fixed
 * 326px viewBox stretched to 100% squashed the line on phones and blew strokes up on
 * desktop. On mount the line wipes in left→right (a clipped container whose width
 * animates — works identically on web and native, unlike animating SVG stroke props),
 * then the end dot pings once. On web, hovering shows a crosshair and a tooltip for the
 * nearest game.
 */
import { useId, useState, useMemo } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle } from "react-native-svg";
import { EASE_OUT } from "./motion";
import { Txt } from "./Txt";
import { colors, radius } from "@/theme";

export interface ChartPoint {
  date: string;
  rating: number;
}

const WIPE_MS = 900;

const WIPE: CSSAnimationKeyframes = {
  from: { width: "0%" },
  to: { width: "100%" },
};

const PING: CSSAnimationKeyframes = {
  from: { opacity: 0.7, transform: [{ scale: 0.6 }] },
  to: { opacity: 0, transform: [{ scale: 2.4 }] },
};

const PAD = { t: 18, r: 10, b: 22, l: 10 };
const TOOLTIP_WIDTH = 116;

/** "2026-09-14" → "14 Sep" without timezone drift (the string is already a calendar date). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function LineChart({
  data,
  height = 150,
  color = colors.accent,
}: {
  data: ChartPoint[];
  height?: number;
  color?: string;
}) {
  const gradientId = `elo-fill-${useId().replace(/:/g, "")}`;
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (!data || data.length < 2) return null;

    const ys = data.map((d) => d.rating);
    const minY = Math.min(...ys) - 12;
    const maxY = Math.max(...ys) + 12;
    const plotW = Math.max(1, width - PAD.l - PAD.r);
    const X = (i: number) => PAD.l + (i / (data.length - 1)) * plotW;
    const Y = (v: number) => PAD.t + (1 - (v - minY) / (maxY - minY)) * (height - PAD.t - PAD.b);
    const line = data
      .map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d.rating).toFixed(1)}`)
      .join(" ");
    const area = `${line} L${X(data.length - 1).toFixed(1)},${height - PAD.b} L${X(0).toFixed(1)},${
      height - PAD.b
    } Z`;
    const last = data[data.length - 1];
    const gridY = [minY, (minY + maxY) / 2, maxY];
    const endX = X(data.length - 1);
    const endY = Y(last.rating);

    return { minY, maxY, plotW, X, Y, line, area, last, gridY, endX, endY };
  }, [data, width, height]);
  if (!geometry) return null;
  const { minY, maxY, plotW, X, Y, line, area, last, gridY, endX, endY } = geometry;

  // Web hover: map the pointer's x to the nearest game. currentTarget is the measured
  // container (react-native-web hands back the DOM node), so the maths is in our space.
  const onPointerMove =
    Platform.OS === "web"
      ? (event: { currentTarget: unknown; nativeEvent: { clientX: number } }) => {
          const node = event.currentTarget as { getBoundingClientRect?: () => DOMRect };
          const rect = node.getBoundingClientRect?.();
          if (!rect) return;
          const x = event.nativeEvent.clientX - rect.left;
          const index = Math.round(((x - PAD.l) / plotW) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, index)));
        }
      : undefined;

  const hovered = hover != null ? data[hover] : null;
  const hoverDelta =
    hover != null && hover > 0 ? data[hover].rating - data[hover - 1].rating : null;
  const tooltipLeft =
    hover != null ? Math.max(0, Math.min(width - TOOLTIP_WIDTH, X(hover) - TOOLTIP_WIDTH / 2)) : 0;

  const chart =
    width > 0 ? (
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {gridY.map((g, i) => (
          <Line
            key={i}
            x1={PAD.l}
            x2={width - PAD.r}
            y1={Y(g)}
            y2={Y(g)}
            stroke={colors.line}
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
        <Path d={area} fill={`url(#${gradientId})`} />
        <Path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover != null ? (
          <>
            <Line
              x1={X(hover)}
              x2={X(hover)}
              y1={PAD.t - 6}
              y2={height - PAD.b}
              stroke={colors.lineStrong}
              strokeWidth={1}
            />
            <Circle
              cx={X(hover)}
              cy={Y(data[hover].rating)}
              r={4}
              fill={colors.bg}
              stroke={color}
              strokeWidth={2}
            />
          </>
        ) : null}
        <Circle cx={endX} cy={endY} r={4.5} fill={color} stroke={colors.bg} strokeWidth={2} />
      </Svg>
    ) : null;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      style={{ height, width: "100%" }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Rating chart: ${data[0].rating} to ${last.rating} over ${
        data.length - 1
      } games`}
      {...(onPointerMove
        ? { onPointerMove, onPointerLeave: () => setHover(null) }
        : ({} as Record<string, never>))}
    >
      {/* Y labels sit just above the top and bottom gridlines, inside the plot. */}
      {width > 0 ? (
        <>
          <Txt
            variant="mono"
            size={9.5}
            color={colors.textFaint}
            style={[styles.yLabel, { top: Y(maxY) - 14, left: PAD.l }]}
          >
            {Math.round(maxY)}
          </Txt>
          <Txt
            variant="mono"
            size={9.5}
            color={colors.textFaint}
            style={[styles.yLabel, { top: Y(minY) - 14, left: PAD.l }]}
          >
            {Math.round(minY)}
          </Txt>
          <Txt
            variant="mono"
            size={9.5}
            color={colors.textFaint}
            style={[styles.xLabel, { left: PAD.l }]}
          >
            {shortDate(data[0].date)}
          </Txt>
          <Txt
            variant="mono"
            size={9.5}
            color={colors.textFaint}
            style={[styles.xLabel, { right: PAD.r }]}
          >
            {shortDate(last.date)}
          </Txt>
        </>
      ) : null}

      {reduced ? (
        <View style={StyleSheet.absoluteFill}>{chart}</View>
      ) : (
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "100%",
            overflow: "hidden",
            animationName: WIPE,
            animationDuration: WIPE_MS,
            animationTimingFunction: EASE_OUT,
            animationFillMode: "backwards",
          }}
        >
          {chart}
        </Animated.View>
      )}

      {width > 0 && !reduced ? (
        <Animated.View
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: endX - 9,
            top: endY - 9,
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 2,
            borderColor: color,
            opacity: 0,
            animationName: PING,
            animationDuration: 900,
            animationDelay: WIPE_MS - 150,
            animationIterationCount: 2,
            animationTimingFunction: "ease-out",
          }}
        />
      ) : null}

      {hovered ? (
        <View style={[styles.tooltip, { left: tooltipLeft }]}>
          <Txt variant="monoBold" size={14}>
            {hovered.rating}
            {hoverDelta != null && hoverDelta !== 0 ? (
              <Txt variant="monoBold" size={11} color={hoverDelta > 0 ? colors.win : colors.loss}>
                {"  "}
                {hoverDelta > 0 ? "+" : ""}
                {hoverDelta}
              </Txt>
            ) : null}
          </Txt>
          <Txt variant="mono" size={10} color={colors.textDim}>
            {hover === 0 ? "Start · " : `Game ${hover} · `}
            {shortDate(hovered.date)}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  yLabel: { position: "absolute" },
  xLabel: { position: "absolute", bottom: 2 },
  tooltip: {
    position: "absolute",
    pointerEvents: "none",
    top: 0,
    width: TOOLTIP_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface2,
  },
});
