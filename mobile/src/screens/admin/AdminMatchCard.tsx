/**
 * One pending/disputed result in the admin queue: confirm it, correct the score (then
 * confirm), void it, or look at the stats-screen photo. Every action shows its own
 * spinner, blocks the others while it runs, and reports success as a toast.
 */
import { useState } from "react";
import { Image, StyleSheet, TextInput, View } from "react-native";
import { Button, Card, Tag, Txt } from "@/components";
import { Form, submitOnEnter } from "@/components/FormScreen";
import {
  resolveMatch,
  getMatchPhotoUrl,
  type AdminPendingMatch,
  type LeaguePlayer,
} from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { formStyles } from "./common";

type Busy = "confirm" | "correct" | "void" | null;

function formatWhen(date: Date | null): string {
  if (!date) return "Date unknown";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminMatchCard({
  match: m,
  players,
  onResolved,
}: {
  match: AdminPendingMatch;
  players: Map<string, LeaguePlayer>;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState(false);
  const [aScore, setAScore] = useState(String(m.aGoals));
  const [bScore, setBScore] = useState(String(m.bGoals));
  const [reason, setReason] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const nameOf = (uid: string | null) => {
    const name = uid ? players.get(uid)?.name : undefined;
    return name ? firstName(name) : "Unknown";
  };
  const aName = nameOf(m.aId);
  const bName = nameOf(m.bId);
  const disputed = m.status === "disputed";

  async function run(
    kind: Exclude<Busy, null>,
    failTitle: string,
    success: string,
    action: () => Promise<unknown>,
  ) {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
      toast.success(success);
      onResolved();
    } catch (error: unknown) {
      showAlert(failTitle, callableErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function doVoid() {
    confirmAction({
      title: "Void match",
      message: `Void the ${m.aGoals}:${m.bGoals} between ${aName} and ${bName}? It will never count toward the table.`,
      confirmLabel: "Void",
      destructive: true,
      onConfirm: () =>
        void run("void", "Couldn't void the match", "Match voided", () =>
          resolveMatch(m.id, "void"),
        ),
    });
  }

  function saveCorrected() {
    const aGoals = Number(aScore);
    const bGoals = Number(bScore);
    const valid = (n: number, raw: string) =>
      raw !== "" && Number.isInteger(n) && n >= 0 && n <= 99;
    if (!valid(aGoals, aScore) || !valid(bGoals, bScore)) {
      setScoreError("Goals must be whole numbers from 0 to 99.");
      return;
    }
    setScoreError(null);
    void run(
      "correct",
      "Couldn't save the score",
      `Corrected to ${aGoals}:${bGoals} and confirmed`,
      () => resolveMatch(m.id, "correct_confirm", { aGoals, bGoals }, reason.trim() || undefined),
    );
  }

  async function togglePhoto() {
    if (photoUrl) {
      setPhotoUrl(null);
      return;
    }
    setPhotoLoading(true);
    try {
      const { url } = await getMatchPhotoUrl(m.id);
      setPhotoUrl(url);
    } catch (error: unknown) {
      showAlert("Photo unavailable", callableErrorMessage(error));
    } finally {
      setPhotoLoading(false);
    }
  }

  const scoreInput = (value: string, onChange: (t: string) => void, label: string) => (
    <TextInput
      value={value}
      onChangeText={(t) => {
        onChange(t.replace(/[^0-9]/g, "").slice(0, 2));
        setScoreError(null);
      }}
      accessibilityLabel={label}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={2}
      selectTextOnFocus
      returnKeyType="done"
      onSubmitEditing={submitOnEnter(saveCorrected)}
      style={[
        formStyles.input,
        styles.scoreInput,
        scoreError ? { borderColor: colors.loss } : null,
      ]}
    />
  );

  return (
    <Card style={disputed ? styles.disputedCard : undefined}>
      <View style={styles.matchTop}>
        <Tag tone={disputed ? "loss" : "accent"}>{disputed ? "DISPUTED" : "PENDING"}</Tag>
        <Txt size={11.5} color={colors.textFaint}>
          {formatWhen(m.date)}
        </Txt>
      </View>

      <Txt variant="monoBold" size={20} style={{ marginTop: spacing.md }}>
        {aName} {m.aGoals} : {m.bGoals} {bName}
      </Txt>
      <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
        {m.aTeam} vs {m.bTeam} · submitted by {nameOf(m.submittedBy)}
        {m.source === "ai_assisted" ? " · from a photo" : ""}
      </Txt>

      {disputed ? (
        <View style={styles.disputeBox}>
          <Txt size={12.5} color={colors.loss} style={{ lineHeight: 18 }}>
            Disputed by {nameOf(m.disputedBy)}
            {m.disputeReason ? `: “${m.disputeReason}”` : "."}
          </Txt>
        </View>
      ) : null}

      {m.photoPath ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon="photo"
            loading={photoLoading}
            onPress={togglePhoto}
            style={{ marginTop: spacing.md }}
          >
            {photoUrl ? "Hide photo" : "View photo"}
          </Button>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.matchPhoto}
              resizeMode="contain"
              accessibilityLabel={`Stats screen photo for ${aName} vs ${bName}`}
            />
          ) : null}
        </>
      ) : null}

      {editing ? (
        <View style={styles.editBox}>
          <Form onSubmit={saveCorrected}>
            <View style={styles.scoreInputs}>
              <View style={styles.scoreSide}>
                <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
                  {aName}
                </Txt>
                {scoreInput(aScore, setAScore, `${aName} goals`)}
              </View>
              <Txt variant="monoBold" size={20} color={colors.textFaint}>
                :
              </Txt>
              <View style={styles.scoreSide}>
                <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
                  {bName}
                </Txt>
                {scoreInput(bScore, setBScore, `${bName} goals`)}
              </View>
            </View>
            {scoreError ? (
              <Txt
                size={12}
                color={colors.loss}
                style={{ textAlign: "center" }}
                accessibilityLiveRegion="polite"
              >
                {scoreError}
              </Txt>
            ) : null}
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Reason for the correction"
              returnKeyType="done"
              onSubmitEditing={submitOnEnter(saveCorrected)}
              style={formStyles.input}
            />
            <View style={styles.actions}>
              <Button
                size="sm"
                loading={busy === "correct"}
                disabled={busy !== null}
                onPress={saveCorrected}
              >
                Save & confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onPress={() => {
                  setEditing(false);
                  setScoreError(null);
                  setAScore(String(m.aGoals));
                  setBScore(String(m.bGoals));
                }}
              >
                Cancel
              </Button>
            </View>
          </Form>
        </View>
      ) : (
        <View style={[styles.actions, { marginTop: spacing.md }]}>
          <Button
            size="sm"
            icon="check"
            loading={busy === "confirm"}
            disabled={busy !== null}
            onPress={() =>
              void run("confirm", "Couldn't confirm the match", "Match confirmed", () =>
                resolveMatch(m.id, "confirm"),
              )
            }
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="dark"
            icon="edit"
            disabled={busy !== null}
            onPress={() => setEditing(true)}
          >
            Edit score
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy === "void"}
            disabled={busy !== null}
            onPress={doVoid}
          >
            Void
          </Button>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  disputedCard: { borderColor: withAlpha(colors.loss, 0.35) },
  matchTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  disputeBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(colors.loss, 0.25),
    backgroundColor: withAlpha(colors.loss, 0.06),
  },
  matchPhoto: {
    width: "100%",
    aspectRatio: 900 / 1280,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    marginTop: spacing.sm,
  },
  editBox: { marginTop: spacing.md, gap: spacing.sm },
  scoreInputs: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: spacing.md,
  },
  scoreSide: { flex: 1, alignItems: "center", gap: 4, minWidth: 0 },
  scoreInput: { width: 64, textAlign: "center", marginBottom: 0, fontSize: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
