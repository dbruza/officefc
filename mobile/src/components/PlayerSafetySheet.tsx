/**
 * Report / block sheet opened from another player's profile (App Store guideline 1.2).
 * Built as a sheet rather than an Alert so it carries a reason picker and a note, and so
 * admin actions fit (Android Alerts cap at three buttons).
 *
 * Phones get a bottom sheet; tablet and up a centred dialog, matching DateTimeField.
 */
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { Reveal } from "./motion";
import { TextField } from "./TextField";
import { Txt } from "./Txt";
import { colors, elevation, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { firstName } from "@/lib/format";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  moderateMember,
  reportPlayer,
  setPlayerBlocked,
  type LeaguePlayer,
  type ReportReason,
} from "@/lib/league";

export function PlayerSafetySheet({
  player,
  visible,
  isAdmin,
  onClose,
  onChanged,
}: {
  player: LeaguePlayer;
  visible: boolean;
  isAdmin: boolean;
  onClose: () => void;
  /** After a block, unblock or admin action, so the profile reloads. */
  onChanged: () => void;
}) {
  const { isTablet } = useBreakpoint();
  const [mode, setMode] = useState<"menu" | "report">("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  // Blocked players come back masked, so name them neutrally in the copy.
  const who = player.blocked ? "this player" : firstName(player.name);

  function close() {
    onClose();
    setMode("menu");
    setReason(null);
    setDetails("");
  }

  async function sendReport() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await reportPlayer({ targetUid: player.id, reason, details: details.trim() || undefined });
      close();
      toast.success("Report sent. The league admins will review it within 24 hours.");
    } catch (e: unknown) {
      showAlert("Couldn't send the report", callableErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleBlock() {
    const blocking = !player.blocked;
    confirmAction({
      title: blocking ? `Block ${who}?` : "Unblock this player?",
      message: blocking
        ? "You won't see their name, photos or activity, and neither of you can log a match against the other. The league admins are told so they can check in. You can unblock them in Settings."
        : "Their name, photos and activity show again, and you can play each other.",
      confirmLabel: blocking ? "Block" : "Unblock",
      destructive: blocking,
      onConfirm: async () => {
        try {
          await setPlayerBlocked(player.id, blocking);
          close();
          toast.success(blocking ? "Player blocked" : "Player unblocked");
          onChanged();
        } catch (e: unknown) {
          showAlert(blocking ? "Couldn't block" : "Couldn't unblock", callableErrorMessage(e));
        }
      },
    });
  }

  function adminAction(action: "remove" | "reset_name") {
    const remove = action === "remove";
    confirmAction({
      title: remove ? `Remove ${who} from the league?` : `Replace ${who}'s name?`,
      message: remove
        ? "They lose access straight away and can't rejoin with a join code. Their past results stay. You can reinstate them from Admin → Safety."
        : "Their name and handle become a neutral “Player” name. They can pick a new one, which is screened again.",
      confirmLabel: remove ? "Remove" : "Replace name",
      destructive: remove,
      onConfirm: async () => {
        try {
          await moderateMember(player.id, action);
          close();
          toast.success(remove ? "Player removed" : "Name replaced");
          onChanged();
        } catch (e: unknown) {
          showAlert("Couldn't do that", callableErrorMessage(e));
        }
      },
    });
  }

  const menu = (
    <View style={styles.rows}>
      <SheetRow
        icon="info"
        label={`Report ${who}`}
        detail="An offensive name or photo, harassment, or fake results."
        onPress={() => setMode("report")}
      />
      <SheetRow
        icon={player.blocked ? "eye" : "eyeOff"}
        label={player.blocked ? "Unblock" : `Block ${who}`}
        detail={
          player.blocked
            ? "Show their name, photos and activity again."
            : "Hide them from you and stop matches between you."
        }
        tone={player.blocked ? undefined : "danger"}
        onPress={toggleBlock}
      />
      {isAdmin && player.status === "active" ? (
        <>
          <Txt variant="head" size={10.5} color={colors.textDim} style={styles.adminLabel}>
            ADMIN
          </Txt>
          <SheetRow
            icon="edit"
            label="Replace name"
            detail="Swap an offensive name for a neutral one."
            onPress={() => adminAction("reset_name")}
          />
          <SheetRow
            icon="logout"
            label="Remove from league"
            detail="Revoke access. Past results stay."
            tone="danger"
            onPress={() => adminAction("remove")}
          />
        </>
      ) : null}
    </View>
  );

  const report = (
    <View>
      <View style={styles.reasons}>
        {REPORT_REASONS.map((value) => {
          const active = reason === value;
          return (
            <Interactive
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={REPORT_REASON_LABELS[value]}
              onPress={() => setReason(value)}
              pressScale={0.98}
              style={[styles.reason, active && styles.reasonActive]}
              hoverStyle={active ? undefined : { borderColor: colors.lineStrong }}
            >
              <View style={[styles.radio, active && styles.radioActive]} />
              <Txt variant="bodyMedium" size={14}>
                {REPORT_REASON_LABELS[value]}
              </Txt>
            </Interactive>
          );
        })}
      </View>
      <TextField
        label="What happened? (optional)"
        value={details}
        onChangeText={(text) => setDetails(text.slice(0, REPORT_DETAILS_MAX))}
        maxLength={REPORT_DETAILS_MAX}
        multiline
        placeholder="Anything that helps the admins act on it"
      />
      <View style={styles.footer}>
        <Button variant="ghost" onPress={() => setMode("menu")}>
          Back
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={!reason}
          onPress={() => void sendReport()}
        >
          Send report
        </Button>
      </View>
    </View>
  );

  const sheet = (
    <SafeAreaView edges={["bottom"]}>
      {isTablet ? null : <View style={styles.handle} />}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt variant="head" size={17}>
            {mode === "report" ? `Report ${who}` : player.name}
          </Txt>
          <Txt size={12.5} color={colors.textDim} style={{ marginTop: 2 }}>
            {mode === "report"
              ? "Reports go to the league admins, who act within 24 hours."
              : "Keep the league friendly."}
          </Txt>
        </View>
      </View>
      {mode === "report" ? report : menu}
    </SafeAreaView>
  );

  return (
    <Modal
      visible={visible}
      animationType={isTablet ? "fade" : "slide"}
      transparent
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.overlay, isTablet && styles.overlayCentered]}>
          <Interactive
            accessibilityLabel="Close"
            onPress={close}
            pressScale={1}
            focusable={false}
            style={[StyleSheet.absoluteFill, webStyle({ cursor: "default" })]}
          />
          {isTablet ? (
            <Reveal
              from="scale"
              duration={200}
              style={[styles.sheet, styles.dialog, webStyle({ boxShadow: elevation.overlay })]}
            >
              {sheet}
            </Reveal>
          ) : (
            <View style={styles.sheet}>{sheet}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  detail,
  tone,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail: string;
  tone?: "danger";
  onPress: () => void;
}) {
  const color = tone === "danger" ? colors.loss : colors.text;
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      pressScale={0.99}
      style={styles.row}
      hoverStyle={{ backgroundColor: colors.surface2 }}
    >
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(color, 0.1) }]}>
        <Icon name={icon} size={17} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={14.5} color={color}>
          {label}
        </Txt>
        <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
          {detail}
        </Txt>
      </View>
      <Icon name="chevron" size={15} color={colors.textFaint} />
    </Interactive>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.58)" },
  overlayCentered: { justifyContent: "center", alignItems: "center", padding: spacing.x2 },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  dialog: {
    width: "100%",
    maxWidth: 440,
    borderRadius: radius.xl,
    borderBottomWidth: 1,
    borderColor: colors.lineStrong,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.textFaint,
  },
  header: { paddingTop: spacing.md, paddingBottom: spacing.md },
  rows: { gap: 2, paddingBottom: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  adminLabel: { letterSpacing: 1.2, marginTop: spacing.md, marginLeft: spacing.sm },
  reasons: { gap: spacing.sm, marginBottom: spacing.lg },
  reason: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  reasonActive: { borderColor: colors.loss, backgroundColor: withAlpha(colors.loss, 0.06) },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textFaint,
  },
  radioActive: { borderColor: colors.loss, backgroundColor: colors.loss },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
