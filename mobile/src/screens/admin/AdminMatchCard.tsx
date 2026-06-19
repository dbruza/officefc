import { useState } from "react";
import { Image, StyleSheet, TextInput, View } from "react-native";
import { Button, Card, Txt } from "@/components";
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
import { errorMessage, formStyles } from "./common";

export function AdminMatchCard({
  match: m,
  players,
  onResolved,
}: {
  match: AdminPendingMatch;
  players: Map<string, LeaguePlayer>;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aScore, setAScore] = useState(String(m.aGoals));
  const [bScore, setBScore] = useState(String(m.bGoals));
  const [reason, setReason] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const nameOf = (uid: string | null) => {
    const name = uid ? players.get(uid)?.name : undefined;
    return name ? firstName(name) : "Unknown";
  };
  const aName = nameOf(m.aId);
  const bName = nameOf(m.bId);
  const disputed = m.status === "disputed";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onResolved();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function doVoid() {
    confirmAction({
      title: "Void match",
      message: `Void the ${m.aGoals}:${m.bGoals} between ${aName} and ${bName}? It will never count toward the table.`,
      confirmLabel: "Void",
      destructive: true,
      onConfirm: () => run(() => resolveMatch(m.id, "void")),
    });
  }

  function saveCorrected() {
    const aGoals = Number(aScore);
    const bGoals = Number(bScore);
    if (
      !Number.isInteger(aGoals) ||
      !Number.isInteger(bGoals) ||
      aGoals < 0 ||
      aGoals > 99 ||
      bGoals < 0 ||
      bGoals > 99
    ) {
      showAlert("Invalid score", "Goals must be whole numbers from 0 to 99.");
      return;
    }
    run(() =>
      resolveMatch(m.id, "correct_confirm", { aGoals, bGoals }, reason.trim() || undefined),
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
      showAlert("Photo unavailable", errorMessage(error));
    } finally {
      setPhotoLoading(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.matchTop}>
        <View style={[styles.badge, disputed ? styles.badgeDisputed : styles.badgePending]}>
          <Txt variant="head" size={10} color={disputed ? colors.loss : colors.accent}>
            {disputed ? "DISPUTED" : "PENDING"}
          </Txt>
        </View>
        <Txt size={11} color={colors.textFaint}>
          {m.date?.toLocaleDateString() ?? "Date unknown"}
        </Txt>
      </View>

      <Txt variant="monoBold" size={20} style={{ marginTop: spacing.md }}>
        {aName} {m.aGoals} : {m.bGoals} {bName}
      </Txt>
      <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
        {m.aTeam} vs {m.bTeam} · submitted by {nameOf(m.submittedBy)}
      </Txt>

      {disputed ? (
        <View style={styles.disputeBox}>
          <Txt size={12} color={colors.loss}>
            Disputed by {nameOf(m.disputedBy)}
            {m.disputeReason ? `: “${m.disputeReason}”` : "."}
          </Txt>
        </View>
      ) : null}

      {m.photoPath ? (
        <>
          <Button
            size="sm"
            variant="dark"
            icon="photo"
            disabled={photoLoading}
            onPress={togglePhoto}
            style={{ marginTop: spacing.md }}
          >
            {photoLoading ? "Loading…" : photoUrl ? "Hide photo" : "View photo"}
          </Button>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.matchPhoto} resizeMode="contain" />
          ) : null}
        </>
      ) : null}

      {editing ? (
        <View style={{ marginTop: spacing.md }}>
          <View style={styles.scoreInputs}>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Txt size={11} color={colors.textDim} style={{ marginBottom: 4 }}>
                {aName}
              </Txt>
              <TextInput
                value={aScore}
                onChangeText={setAScore}
                keyboardType="number-pad"
                maxLength={2}
                style={[formStyles.input, styles.scoreInput]}
              />
            </View>
            <Txt variant="monoBold" size={20} color={colors.textFaint}>
              :
            </Txt>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Txt size={11} color={colors.textDim} style={{ marginBottom: 4 }}>
                {bName}
              </Txt>
              <TextInput
                value={bScore}
                onChangeText={setBScore}
                keyboardType="number-pad"
                maxLength={2}
                style={[formStyles.input, styles.scoreInput]}
              />
            </View>
          </View>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.textFaint}
            style={formStyles.input}
          />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button size="sm" disabled={busy} onPress={saveCorrected}>
              {busy ? "Saving…" : "Save & confirm"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => setEditing(false)}>
              Cancel
            </Button>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            size="sm"
            disabled={busy}
            onPress={() => run(() => resolveMatch(m.id, "confirm"))}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="dark"
            icon="edit"
            disabled={busy}
            onPress={() => setEditing(true)}
          >
            Edit score
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onPress={doVoid}>
            Void
          </Button>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  matchTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeDisputed: {
    borderColor: withAlpha(colors.loss, 0.4),
    backgroundColor: withAlpha(colors.loss, 0.08),
  },
  badgePending: {
    borderColor: withAlpha(colors.accent, 0.4),
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
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
  scoreInputs: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  scoreInput: { width: 64, textAlign: "center", marginBottom: 0 },
});
