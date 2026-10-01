/** Standard empty and error states so every screen says "nothing here" / "that failed" alike. */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

export function EmptyState({
  icon = "info",
  title,
  body,
  action,
  compact,
  style,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  /** Primary call to action (e.g. "Log a match"). */
  action?: { label: string; onPress: () => void; icon?: IconName };
  /** Inline row layout for use inside sections, instead of the centred block. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (compact) {
    return (
      <View style={[styles.box, styles.compact, style]}>
        <View style={styles.iconWrapSm}>
          <Icon name={icon} size={18} color={colors.textDim} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={14}>
            {title}
          </Txt>
          {body ? (
            <Txt size={12.5} color={colors.textDim} style={{ marginTop: 3, lineHeight: 18 }}>
              {body}
            </Txt>
          ) : null}
        </View>
        {action ? (
          <Button size="sm" variant="dark" icon={action.icon} onPress={action.onPress}>
            {action.label}
          </Button>
        ) : null}
      </View>
    );
  }
  return (
    <Reveal from="fade" style={[styles.box, styles.centered, style]}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={24} color={colors.accent} />
      </View>
      <Txt variant="head" size={16} style={{ textAlign: "center", marginTop: spacing.md }}>
        {title}
      </Txt>
      {body ? (
        <Txt
          size={13}
          color={colors.textDim}
          style={{ textAlign: "center", marginTop: 6, lineHeight: 19, maxWidth: 360 }}
        >
          {body}
        </Txt>
      ) : null}
      {action ? (
        <Button
          size="md"
          icon={action.icon}
          onPress={action.onPress}
          style={{ marginTop: spacing.lg, alignSelf: "center" }}
        >
          {action.label}
        </Button>
      ) : null}
    </Reveal>
  );
}

export function ErrorCard({
  message,
  onRetry,
  retrying,
  style,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.error, style]} accessibilityRole="alert">
      <Icon name="info" size={18} color={colors.loss} />
      <Txt size={13} color={colors.text} style={{ flex: 1, lineHeight: 18 }}>
        {message}
      </Txt>
      {onRetry ? (
        <Button size="sm" variant="dark" icon="refresh" loading={retrying} onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </View>
  );
}

/** Small uppercase pill (e.g. "YOU", "NEW", "AI"). */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "gold" | "loss";
}) {
  const palette = {
    neutral: { bg: colors.surface2, fg: colors.textDim },
    accent: { bg: withAlpha(colors.accent, 0.14), fg: colors.accent },
    gold: { bg: withAlpha(colors.gold, 0.14), fg: colors.gold },
    loss: { bg: withAlpha(colors.loss, 0.14), fg: colors.loss },
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      <Txt variant="monoBold" size={9.5} color={palette.fg} style={{ letterSpacing: 0.8 }}>
        {children}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  centered: {
    alignItems: "center",
    paddingVertical: spacing.x3,
    paddingHorizontal: spacing.x2,
  },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.25),
  },
  iconWrapSm: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingLeft: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.35),
    backgroundColor: mix(colors.surface, colors.loss, 6),
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 5,
    alignSelf: "flex-start",
  },
});
