/**
 * Generic surface container (the prototype's `.card`). Pressable when `onPress` given:
 * then it lifts on hover and scales slightly on press.
 */
import { ReactNode } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Interactive } from "./Interactive";
import { colors, radius } from "@/theme";

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, padded = true, accessibilityLabel }: CardProps) {
  const base = [styles.card, padded && styles.padded, style];
  if (onPress) {
    // Brighten the edge on hover only for default-bordered cards; tinted cards (hero,
    // nemesis) keep their colour and rely on the lift.
    const customBorder = StyleSheet.flatten(style)?.borderColor !== undefined;
    return (
      <Interactive
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        lift
        pressScale={0.99}
        style={base}
        hoverStyle={customBorder ? undefined : { borderColor: colors.lineStrong }}
      >
        {children}
      </Interactive>
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
