/**
 * Themed button: primary / dark / ghost / danger, with optional icon, hover + press
 * feedback, and a `loading` state that disables it and swaps the icon for a spinner
 * (so a double click can't fire the action twice).
 */
import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./Txt";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { colors, elevation, radius } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { webStyle } from "@/lib/web";

type Variant = "primary" | "dark" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps {
  children: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  full?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Busy: shows a spinner, blocks presses, and announces busy to assistive tech. */
  loading?: boolean;
  accessibilityLabel?: string;
}

const sizing: Record<Size, { padV: number; padH: number; font: number; icon: number }> = {
  sm: { padV: 8, padH: 12, font: 13, icon: 16 },
  md: { padV: 12, padH: 16, font: 14.5, icon: 17 },
  lg: { padV: 16, padH: 20, font: 16, icon: 20 },
};

const variants: Record<
  Variant,
  { bg: string; fg: string; border: string; hoverBg: string; hoverBorder: string }
> = {
  primary: {
    bg: colors.accent,
    fg: colors.onAccent,
    border: colors.accent,
    hoverBg: mix(colors.accent, "#ffffff", 22),
    hoverBorder: mix(colors.accent, "#ffffff", 22),
  },
  dark: {
    bg: colors.surface2,
    fg: colors.text,
    border: colors.line,
    hoverBg: colors.surface3,
    hoverBorder: colors.lineStrong,
  },
  ghost: {
    bg: "transparent",
    fg: colors.text,
    border: colors.line,
    hoverBg: colors.surface,
    hoverBorder: colors.lineStrong,
  },
  danger: {
    bg: "transparent",
    fg: colors.loss,
    border: withAlpha(colors.loss, 0.4),
    hoverBg: withAlpha(colors.loss, 0.1),
    hoverBorder: withAlpha(colors.loss, 0.7),
  },
};

const primaryGlow = webStyle({ boxShadow: elevation.glow });

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  full,
  onPress,
  style,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: ButtonProps) {
  const s = sizing[size];
  const v = variants[variant];
  const blocked = disabled || loading;
  return (
    <Interactive
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: blocked, busy: loading }}
      pressScale={0.97}
      style={[
        styles.base,
        webStyle({ userSelect: "none" }),
        {
          paddingVertical: s.padV,
          paddingHorizontal: s.padH,
          backgroundColor: v.bg,
          borderColor: v.border,
          alignSelf: full ? "stretch" : "flex-start",
          width: full ? "100%" : undefined,
          opacity: disabled && !loading ? 0.42 : 1,
        },
        style,
      ]}
      hoverStyle={[
        { backgroundColor: v.hoverBg, borderColor: v.hoverBorder },
        variant === "primary" && primaryGlow,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} style={{ height: s.icon, width: s.icon }} />
      ) : icon ? (
        <Icon name={icon} size={s.icon} stroke={2.4} color={v.fg} />
      ) : null}
      <Txt variant="head" size={s.font} color={v.fg}>
        {children}
      </Txt>
    </Interactive>
  );
}

/**
 * Round icon-only button (back, refresh, header actions). Always pass an
 * `accessibilityLabel` — there is no visible text.
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 40,
  iconSize = 19,
  color = colors.text,
  tone = "surface",
  disabled,
  style,
  children,
}: {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  iconSize?: number;
  color?: string;
  tone?: "surface" | "ghost" | "accent";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Overlay content (e.g. a count badge). */
  children?: React.ReactNode;
}) {
  const bg = tone === "accent" ? colors.accent : tone === "ghost" ? "transparent" : colors.surface;
  return (
    <Interactive
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      pressScale={0.92}
      style={[
        styles.icon,
        {
          width: size,
          height: size,
          backgroundColor: bg,
          borderColor: tone === "accent" ? colors.accent : colors.line,
          opacity: disabled ? 0.42 : 1,
        },
        style,
      ]}
      hoverStyle={
        tone === "accent"
          ? [{ backgroundColor: mix(colors.accent, "#ffffff", 22) }, primaryGlow]
          : { backgroundColor: colors.surface2, borderColor: colors.lineStrong }
      }
    >
      <Icon name={icon} size={iconSize} color={tone === "accent" ? colors.onAccent : color} />
      {children}
    </Interactive>
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
  icon: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
