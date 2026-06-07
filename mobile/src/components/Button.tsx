/** Themed pressable button: primary / dark / ghost / danger, with optional icon. */
import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { Icon, type IconName } from "./Icon";
import { colors, radius } from "@/theme";
import { withAlpha } from "@/lib/color";

type Variant = "primary" | "dark" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps {
  children: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  full?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  disabled?: boolean;
}

const sizing: Record<Size, { padV: number; padH: number; font: number; icon: number }> = {
  sm: { padV: 8, padH: 12, font: 13, icon: 16 },
  md: { padV: 12, padH: 16, font: 14.5, icon: 17 },
  lg: { padV: 16, padH: 20, font: 16, icon: 20 },
};

const variants: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  dark: { bg: colors.surface2, fg: colors.text, border: colors.line },
  ghost: { bg: "transparent", fg: colors.text, border: colors.line },
  danger: { bg: "transparent", fg: colors.loss, border: withAlpha(colors.loss, 0.4) },
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  full,
  onPress,
  style,
  disabled = false,
}: ButtonProps) {
  const s = sizing[size];
  const v = variants[variant];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: s.padV,
          paddingHorizontal: s.padH,
          backgroundColor: v.bg,
          borderColor: v.border,
          alignSelf: full ? "stretch" : "flex-start",
          width: full ? "100%" : undefined,
          opacity: disabled ? 0.42 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={s.icon} stroke={2.4} color={v.fg} /> : null}
      <Txt variant="head" size={s.font} color={v.fg}>
        {children}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
