/** Compact stat tile: uppercase label, big value, optional sub-line / children. */
import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Txt } from "./Txt";
import { colors, radius } from "@/theme";

export interface StatCardProps {
  label: string;
  value?: string | number;
  sub?: string;
  accent?: boolean;
  /** Render the value in tabular mono (default) vs. the display face. */
  mono?: boolean;
  children?: ReactNode;
}

export function StatCard({ label, value, sub, accent, mono = true, children }: StatCardProps) {
  return (
    <View style={styles.card}>
      <Txt variant="head" size={10.5} color={colors.textDim} style={styles.label}>
        {label.toUpperCase()}
      </Txt>
      {value !== undefined && (
        <Txt
          variant={mono ? "monoBold" : "head"}
          size={30}
          color={accent ? colors.accent : colors.text}
          style={styles.value}
        >
          {value}
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
  label: {
    letterSpacing: 1.2,
  },
  value: {
    lineHeight: 31,
    letterSpacing: -0.6,
  },
});
