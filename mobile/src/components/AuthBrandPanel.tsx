/**
 * Left-hand brand panel for auth/onboarding on desktop (≥1024): a tilted pitch drawn in
 * accent lines over a soft glow, the wordmark, a tagline and three product promises.
 * Everything enters once (Reveal); nothing loops, so the panel stays calm while someone
 * types their password next to it.
 */
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Icon, type IconName } from "./Icon";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

const LINE = withAlpha(colors.accent, 0.34);

/**
 * Top-down pitch at FIFA proportions (68 × 105 m → 520 × 800 units, 7.65 units per
 * metre) so the boxes and arcs read as a real pitch once tilted.
 */
function PitchLines() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid meet">
      <Defs>
        <RadialGradient id="pitchGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.16} />
          <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={600} height={900} fill="url(#pitchGlow)" />
      <Rect x={40} y={50} width={520} height={800} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Line x1={40} y1={450} x2={560} y2={450} stroke={LINE} strokeWidth={2.5} />
      <Circle cx={300} cy={450} r={70} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Circle cx={300} cy={450} r={4} fill={LINE} />
      {/* Penalty areas, goal areas, spots and the "D" arcs at both ends. */}
      <Rect x={146} y={50} width={308} height={126} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Rect x={146} y={724} width={308} height={126} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Rect x={230} y={50} width={140} height={42} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Rect x={230} y={808} width={140} height={42} stroke={LINE} strokeWidth={2.5} fill="none" />
      <Circle cx={300} cy={134} r={3.5} fill={LINE} />
      <Circle cx={300} cy={766} r={3.5} fill={LINE} />
      <Path d="M244 176 A70 70 0 0 0 356 176" stroke={LINE} strokeWidth={2.5} fill="none" />
      <Path d="M244 724 A70 70 0 0 1 356 724" stroke={LINE} strokeWidth={2.5} fill="none" />
      {/* Goals, just behind each line. */}
      <Rect x={264} y={38} width={72} height={12} stroke={LINE} strokeWidth={2} fill="none" />
      <Rect x={264} y={850} width={72} height={12} stroke={LINE} strokeWidth={2} fill="none" />
    </Svg>
  );
}

/** Soft accent bloom behind the copy (an SVG gradient — RN has no CSS radial-gradient). */
function Glow() {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="panelGlow" cx="18%" cy="12%" r="70%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.13} />
          <Stop offset="0.55" stopColor={colors.accent} stopOpacity={0.03} />
          <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#panelGlow)" />
    </Svg>
  );
}

const PROMISES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "trend",
    title: "Ratings that mean something",
    body: "ELO that weighs who you played and the team you picked.",
  },
  {
    icon: "handshake",
    title: "Every result confirmed",
    body: "Both players sign off, so the table settles arguments instead of starting them.",
  },
  {
    icon: "trophy",
    title: "Seasons with a finish",
    body: "Finals, a mid-season cup and a recap for every champion.",
  },
];

export function AuthBrandPanel() {
  return (
    <View style={styles.panel}>
      <Glow />
      <Reveal from="scale" duration={1400} delay={120} style={styles.pitchWrap}>
        <View style={styles.pitchTilt}>
          <PitchLines />
        </View>
      </Reveal>

      <View style={styles.content}>
        <Reveal from="right" duration={600}>
          <View style={styles.wordmark}>
            <View style={styles.ball}>
              <Icon name="ball" size={22} color={colors.onAccent} stroke={2.2} />
            </View>
            <Txt variant="head" size={20} style={{ letterSpacing: 3 }}>
              OFFICE
              <Txt variant="head" size={20} color={colors.accent}>
                FC
              </Txt>
            </Txt>
          </View>
        </Reveal>

        <View style={styles.copy}>
          <Reveal delay={140}>
            <Txt variant="head" size={46} style={styles.headline}>
              Settle it{"\n"}
              <Txt variant="head" size={46} color={colors.accent}>
                on the pitch.
              </Txt>
            </Txt>
          </Reveal>
          <Reveal delay={220}>
            <Txt size={16} color={colors.textDim} style={styles.tagline}>
              The league table for your office FC rivalries: log a result, get it confirmed, watch
              the ratings move.
            </Txt>
          </Reveal>

          <View style={styles.promises}>
            {PROMISES.map((promise, i) => (
              <Reveal key={promise.title} index={i} delay={320} style={styles.promise}>
                <View style={styles.promiseIcon}>
                  <Icon name={promise.icon} size={17} color={colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="head" size={14}>
                    {promise.title}
                  </Txt>
                  <Txt size={13} color={colors.textDim} style={{ marginTop: 2, lineHeight: 19 }}>
                    {promise.body}
                  </Txt>
                </View>
              </Reveal>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1.15,
    overflow: "hidden",
    backgroundColor: mix(colors.bg, colors.surface, 55),
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  pitchWrap: {
    position: "absolute",
    left: "8%",
    right: "-22%",
    top: "34%",
    bottom: "-40%",
  },
  pitchTilt: {
    flex: 1,
    transform: [{ perspective: 1100 }, { rotateX: "58deg" }, { rotateZ: "-18deg" }],
  },
  content: {
    flex: 1,
    paddingHorizontal: 56,
    paddingTop: 48,
    paddingBottom: 48,
  },
  wordmark: { flexDirection: "row", alignItems: "center", gap: 12 },
  ball: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { marginTop: "12%", maxWidth: 480 },
  headline: { lineHeight: 52, letterSpacing: -1 },
  tagline: { marginTop: spacing.lg, lineHeight: 24 },
  promises: { marginTop: spacing.x3, gap: spacing.lg },
  promise: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  promiseIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.22),
  },
});
