/**
 * Renders web dialogs requested through src/lib/dialogs.ts as an animated, themed
 * modal: backdrop fade, card scale-in, Escape = cancel, Enter = the primary action.
 * Mounted once in the root layout. Native never queues here (it uses Alert).
 */
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Reveal } from "./motion";
import { Txt } from "./Txt";
import { colors, elevation, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import {
  dismissDialog,
  subscribeDialogs,
  type DialogOption,
  type DialogRequest,
} from "@/lib/dialogs";
import { webStyle } from "@/lib/web";

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);
  const current = queue[0];

  useEffect(() => {
    if (!current || Platform.OS !== "web") return;
    // Drop focus from whatever opened us so Enter can't re-submit the underlying form.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      // Capture phase + stopImmediatePropagation: while a dialog is open it owns Esc/Enter,
      // so screen-level shortcuts underneath (wizard Enter = next, Esc = back) never fire.
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(current, event.key === "Escape" ? cancelOf(current) : primaryOf(current));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current]);

  if (!current) return null;
  const actions = current.options;
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer, webStyle({ position: "fixed" })]}>
      <Reveal from="fade" duration={180} style={StyleSheet.absoluteFill}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={() => choose(current, cancelOf(current))}
          accessibilityLabel="Dismiss dialog"
        />
      </Reveal>
      <Reveal key={current.id} from="scale" duration={240} style={styles.cardWrap}>
        <View
          style={[styles.card, webStyle({ boxShadow: elevation.overlay })]}
          role="alertdialog"
          aria-modal
          aria-label={current.title}
          accessibilityViewIsModal
        >
          <Txt variant="head" size={18} accessibilityRole="header">
            {current.title}
          </Txt>
          {current.message ? (
            <Txt size={14} color={colors.textDim} style={styles.message}>
              {current.message}
            </Txt>
          ) : null}
          <View style={[styles.actions, actions.length > 2 && styles.actionsStacked]}>
            {orderForDisplay(actions).map((option) => (
              <Button
                key={option.label}
                size="md"
                variant={variantFor(option)}
                full={actions.length > 2}
                onPress={() => choose(current, option)}
                style={actions.length <= 2 ? { flexGrow: 1 } : undefined}
              >
                {option.label}
              </Button>
            ))}
          </View>
        </View>
      </Reveal>
    </View>
  );
}

function choose(request: DialogRequest, option: DialogOption | undefined) {
  dismissDialog(request.id);
  option?.onPress?.();
}

function cancelOf(request: DialogRequest): DialogOption | undefined {
  // A lone OK dialog: Escape just closes it without running anything.
  return request.options.find((o) => o.style === "cancel");
}

function primaryOf(request: DialogRequest): DialogOption | undefined {
  const actionable = request.options.filter((o) => o.style !== "cancel");
  // With several equal choices (e.g. pick a winner), Enter must not guess.
  if (actionable.length > 1) return undefined;
  return actionable[0];
}

/** Cancel first (left / top), actions after — matches platform convention. */
function orderForDisplay(options: DialogOption[]): DialogOption[] {
  return [
    ...options.filter((o) => o.style === "cancel"),
    ...options.filter((o) => o.style !== "cancel"),
  ];
}

function variantFor(option: DialogOption) {
  if (option.style === "destructive") return "danger" as const;
  if (option.style === "cancel") return "ghost" as const;
  if (option.style === "primary") return "primary" as const;
  return "dark" as const;
}

const styles = StyleSheet.create({
  layer: {
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  backdrop: {
    backgroundColor: withAlpha("#000000", 0.62),
    ...webStyle({ backdropFilter: "blur(6px)" }),
  },
  cardWrap: { width: "100%", maxWidth: 420 },
  card: {
    width: "100%",
    padding: spacing.x2,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  message: { marginTop: spacing.sm, lineHeight: 20 },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.x2,
  },
  actionsStacked: { flexDirection: "column-reverse" },
});
