/**
 * Renders toasts from src/lib/toast.ts: top-centre on phones (below the notch),
 * bottom-right on desktop. Each slides in, auto-dismisses, and can be closed early.
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, elevation, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { useBreakpoint } from "@/lib/responsive";
import { dismissToast, subscribeToasts, type Toast, type ToastTone } from "@/lib/toast";
import { webStyle } from "@/lib/web";

const TONE: Record<ToastTone, { icon: IconName; color: string }> = {
  success: { icon: "check", color: colors.accent },
  error: { icon: "info", color: colors.loss },
  info: { icon: "info", color: colors.textDim },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useBreakpoint();
  useEffect(() => subscribeToasts(setToasts), []);
  if (!toasts.length) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        webStyle({ position: "fixed" }),
        isDesktop
          ? { bottom: spacing.x2, right: spacing.x2, alignItems: "flex-end" }
          : { top: insets.top + spacing.sm, left: spacing.lg, right: spacing.lg },
      ]}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} fromBottom={isDesktop} />
      ))}
    </View>
  );
}

function ToastItem({ toast, fromBottom }: { toast: Toast; fromBottom: boolean }) {
  const tone = TONE[toast.tone];
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);
  return (
    <Reveal from={fromBottom ? "up" : "down"} duration={300} style={styles.itemWrap}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.item,
          {
            borderColor: withAlpha(tone.color, 0.35),
            backgroundColor: mix(colors.surface2, tone.color, 6),
          },
          webStyle({ boxShadow: elevation.overlay }),
        ]}
      >
        <View style={[styles.iconDot, { backgroundColor: withAlpha(tone.color, 0.16) }]}>
          <Icon name={tone.icon} size={14} stroke={2.6} color={tone.color} />
        </View>
        <Txt size={13.5} style={{ flex: 1, lineHeight: 19 }}>
          {toast.message}
        </Txt>
        {toast.action ? (
          <Interactive
            onPress={() => {
              dismissToast(toast.id);
              toast.action?.onPress();
            }}
            style={styles.action}
            hoverStyle={{ backgroundColor: withAlpha(colors.accent, 0.12) }}
          >
            <Txt variant="head" size={12.5} color={colors.accent}>
              {toast.action.label}
            </Txt>
          </Interactive>
        ) : null}
        <Interactive
          onPress={() => dismissToast(toast.id)}
          accessibilityLabel="Dismiss"
          style={styles.close}
          hoverStyle={{ backgroundColor: colors.surface3 }}
        >
          <Icon name="x" size={13} color={colors.textDim} />
        </Interactive>
      </View>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    zIndex: 900,
    gap: spacing.sm,
  },
  itemWrap: { width: "100%", maxWidth: 400 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  iconDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  action: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
});
