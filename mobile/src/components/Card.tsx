/** Generic surface container (the prototype's `.card`). Pressable when `onPress` given. */
import { ReactNode } from "react";
import { Pressable, View, StyleSheet, ViewStyle } from "react-native";
import { colors, radius } from "@/theme";

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  padded?: boolean;
}

export function Card({ children, onPress, style, padded = true }: CardProps) {
  const base = [styles.card, padded && styles.padded, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.9 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
  },
  padded: {
    padding: 16,
  },
});
