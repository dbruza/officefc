/**
 * Confirm / Dispute controls for a result awaiting the viewer's verdict. Shared by the
 * confirmations inbox and the match detail screen (where a `match_pending` push lands),
 * so both resolve a match the same way: Confirm is one tap; Dispute opens an optional
 * reason field and then asks for confirmation, since it pulls the result out of the
 * table and hands it to an admin. Outcomes are toasts — good news shouldn't need an OK.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Reveal } from "./motion";
import { TextField } from "./TextField";
import { confirmMatch, disputeMatch } from "@/lib/league";
import { confirmAction } from "@/lib/dialogs";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "@/lib/toast";
import { spacing } from "@/theme";

/** Server cap on dispute reasons (functions trims to 240). */
const REASON_MAX = 240;

export type Verdict = "confirm" | "dispute";

export interface VerdictActionsProps {
  matchId: string;
  /** Opponent's first name, for copy ("Tell Sam what's wrong"). */
  opponentName: string;
  /** Toast shown after a successful confirm (e.g. with the ELO change). */
  confirmMessage?: string;
  /** Called after the server accepted the verdict. */
  onResolved?: (verdict: Verdict) => void;
  /** Optional toast action after confirming (e.g. "View" the match). */
  confirmAction?: { label: string; onPress: () => void };
  /** Lay the buttons out large (sticky footer) vs. card-sized. */
  size?: "md" | "lg";
}

export function VerdictActions({
  matchId,
  opponentName,
  confirmMessage = "Result confirmed — it's in the table.",
  onResolved,
  confirmAction: toastAction,
  size = "md",
}: VerdictActionsProps) {
  const [busy, setBusy] = useState<Verdict | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");

  async function run(verdict: Verdict) {
    setBusy(verdict);
    try {
      if (verdict === "confirm") {
        await confirmMatch(matchId);
        toast.success(confirmMessage, toastAction ? { action: toastAction } : {});
      } else {
        await disputeMatch(matchId, reason.trim() || "Opponent disputed the submitted result.");
        toast.info("Result disputed — an admin will review it and settle the score.");
      }
      onResolved?.(verdict);
    } catch (err) {
      toast.error(
        friendlyError(err, "That result couldn't be updated. It may already have been resolved."),
      );
    } finally {
      setBusy(null);
    }
  }

  function sendDispute() {
    confirmAction({
      title: "Dispute this result?",
      message: `It won't count while disputed. ${opponentName} is notified and an admin settles the score.`,
      confirmLabel: "Dispute result",
      destructive: true,
      onConfirm: () => void run("dispute"),
    });
  }

  if (disputing) {
    return (
      <Reveal from="fade" duration={200} style={{ gap: spacing.md }}>
        <TextField
          label="What's wrong? (optional)"
          value={reason}
          onChangeText={(text) => setReason(text.slice(0, REASON_MAX))}
          placeholder="e.g. Wrong score, or we never played this"
          autoFocus
          maxLength={REASON_MAX}
          returnKeyType="send"
          onSubmitEditing={sendDispute}
          hint={reason.length > REASON_MAX - 40 ? `${REASON_MAX - reason.length} left` : undefined}
        />
        <View style={styles.row}>
          <Button
            variant="ghost"
            size={size}
            onPress={() => setDisputing(false)}
            disabled={busy !== null}
            style={styles.grow}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size={size}
            icon="flame"
            loading={busy === "dispute"}
            onPress={sendDispute}
            style={styles.grow}
          >
            Send dispute
          </Button>
        </View>
      </Reveal>
    );
  }

  return (
    <View style={styles.row}>
      <Button
        variant="danger"
        size={size}
        disabled={busy !== null}
        onPress={() => setDisputing(true)}
        style={styles.grow}
        accessibilityLabel="Dispute this result"
      >
        Dispute
      </Button>
      <Button
        size={size}
        icon="check"
        loading={busy === "confirm"}
        disabled={busy === "dispute"}
        onPress={() => void run("confirm")}
        style={[styles.grow, { flexGrow: 1.4 }]}
        accessibilityLabel="Confirm this result"
      >
        Confirm
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  grow: { flexGrow: 1, flexBasis: 0 },
});
