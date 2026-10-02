/**
 * The AI pundit card on the match detail screen: headline, surprise verdict,
 * summary prose, rating story, and three talking points. Renders only for
 * confirmed matches; a failed generation keeps the card hidden (never an error state).
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Card } from "./Card";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import type { MatchAnalysis } from "@/lib/league/matchAnalysis";

const VERDICT: Record<
  MatchAnalysis["surpriseLevel"],
  { label: string; icon: IconName; tint: string }
> = {
  expected: { label: "As expected", icon: "check", tint: colors.textDim },
  mild_upset: { label: "Upset", icon: "bolt", tint: colors.accent },
  shock: { label: "Shock", icon: "flame", tint: colors.loss },
};

export function MatchAnalysisCard({
  analysis,
  onRetry,
}: {
  analysis: MatchAnalysis;
  /** Re-run generation after an initial failure. */
  onRetry?: () => void;
}) {
  const verdict = VERDICT[analysis.surpriseLevel];
  const fallback = analysis.model === "fallback";
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <Icon name="swords" size={15} color={colors.accent} />
        <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
          AI ANALYSIS{fallback ? " · OFFLINE PUNDIT" : ""}
        </Txt>
        <View style={[styles.verdict, { borderColor: withAlpha(verdict.tint, 0.35) }]}>
          <Icon name={verdict.icon} size={10} color={verdict.tint} />
          <Txt variant="monoBold" size={8.5} color={verdict.tint}>
            {" "}
            {verdict.label.toUpperCase()}
          </Txt>
        </View>
      </View>

      <Txt variant="head" size={16.5} style={{ marginTop: spacing.sm }}>
        {analysis.headline}
      </Txt>
      {analysis.summary ? (
        <Txt size={12.5} color={colors.textDim} style={{ marginTop: 6, lineHeight: 18 }}>
          {analysis.summary}
        </Txt>
      ) : null}

      <View style={styles.divider} />

      {analysis.ratingStory ? (
        <View style={styles.row}>
          <Icon name="trend" size={13} color={colors.textDim} />
          <Txt size={11.5} color={colors.textDim} style={styles.rowText}>
            {analysis.ratingStory}
          </Txt>
        </View>
      ) : null}
      {analysis.surpriseNote ? (
        <View style={[styles.row, styles.noteRow]}>
          <Icon name={verdict.icon} size={13} color={verdict.tint} />
          <Txt size={11.5} color={colors.textDim} style={styles.rowText}>
            {analysis.surpriseNote}
          </Txt>
        </View>
      ) : null}

      {analysis.talkingPoints.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
            TALKING POINTS
          </Txt>
          <View style={{ gap: 7, marginTop: spacing.sm }}>
            {analysis.talkingPoints.map((point, index) => (
              <View key={`${index}-${point.slice(0, 12)}`} style={styles.point}>
                <Txt variant="monoBold" size={10} color={colors.accent}>
                  {index + 1}
                </Txt>
                <Txt size={12} style={styles.pointText}>
                  {point}
                </Txt>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retry}>
          <Txt variant="head" size={11} color={colors.accent}>
            Try full AI analysis again
          </Txt>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Compact loading row shown while the first generation runs. */
export function AnalysisLoading() {
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <Icon name="swords" size={15} color={colors.accent} />
        <Txt variant="head" size={9.5} color={colors.textDim} style={styles.kicker}>
          AI ANALYSIS
        </Txt>
      </View>
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.accent} />
        <Txt size={12} color={colors.textDim}>
          The pundit is watching the tape…
        </Txt>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mix(colors.surface, "#17304a", 18),
    borderColor: withAlpha(colors.accent, 0.13),
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  kicker: { letterSpacing: 1.15, flex: 1 },
  verdict: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },
  noteRow: { marginBottom: 0 },
  rowText: { flex: 1, lineHeight: 16.5 },
  point: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  pointText: { flex: 1, lineHeight: 17 },
  retry: { marginTop: spacing.md, alignItems: "center" },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
