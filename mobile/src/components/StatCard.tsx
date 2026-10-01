/** Compact stat tile: uppercase label, big value, optional sub-line / children. */
import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Txt } from "./Txt";
import { Icon, type IconName } from "./Icon";
import { CountUp } from "./motion";
import { colors, radius } from "@/theme";

export interface StatCardProps {
  label: string;
  value?: string | number;
  sub?: string;
  accent?: boolean;
  /** Render the value in tabular mono (default) vs. the display face. */
  mono?: boolean;
  /**
   * Tick a numeric `value` up from 0 on mount (and toward later changes). Opt-in so
   * screens that re-render stat grids often don't replay it.
   */
  countUp?: boolean;
  /** Appended to a counted-up value, e.g. "%". */
  suffix?: string;
  /** Small glyph beside the label (e.g. a flame on a hot streak). */
  icon?: IconName;
  iconColor?: string;
  children?: ReactNode;
}

export function StatCard({
  label,
  value,
  sub,
  accent,
  mono = true,
  countUp,
  suffix = "",
  icon,
  iconColor,
  children,
}: StatCardProps) {
  const valueColor = accent ? colors.accent : colors.text;
  const variant = mono ? "monoBold" : "head";
  return (
    <View style={styles.card}>
      <View style={styles.labelRow}>
        <Txt variant="head" size={10.5} color={colors.textDim} style={styles.label}>
          {label.toUpperCase()}
        </Txt>
        {icon ? <Icon name={icon} size={14} color={iconColor ?? valueColor} /> : null}
      </View>
      {value === undefined ? null : countUp && typeof value === "number" ? (
        <CountUp
          value={value}
          from={0}
          variant={variant}
          size={30}
          color={valueColor}
          style={styles.value}
          format={(n) => `${n}${suffix}`}
        />
      ) : (
        <Txt variant={variant} size={30} color={valueColor} style={styles.value}>
          {value}
          {suffix}
        </Txt>
      )}
      {sub ? (
        <Txt size={11.5} color={colors.textDim}>
          {sub}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 2,
    minWidth: 0,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  label: {
    letterSpacing: 1.2,
  },
  value: {
    lineHeight: 31,
    letterSpacing: -0.6,
  },
});
