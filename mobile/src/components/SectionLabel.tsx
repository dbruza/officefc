/** Uppercase section header with an optional right-aligned action. */
import { ReactNode } from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { colors } from "@/theme";

export function SectionLabel({
  children,
  action,
  style,
}: {
  children: string;
  action?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.row, style]}>
      <Txt
        variant="head"
        size={12}
        color={colors.textDim}
        style={styles.label}
        accessibilityRole="header"
      >
        {children.toUpperCase()}
      </Txt>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginHorizontal: 2,
    marginBottom: 10,
    marginTop: 2,
  },
  label: {
    letterSpacing: 1.5,
  },
});
