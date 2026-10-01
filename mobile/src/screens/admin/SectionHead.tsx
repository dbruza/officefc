/** Heading row for an admin section: title + one-line purpose, with an optional action. */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Txt } from "@/components";
import { colors, spacing } from "@/theme";

export function SectionHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="head" size={18} accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={12.5} color={colors.textDim} style={{ marginTop: 3, lineHeight: 18 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
});
