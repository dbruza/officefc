/**
 * Admin → Maintenance: league-wide operations that rewrite history. Kept apart from the
 * everyday tools (and styled as a danger zone) so nobody fires one while looking for
 * "update team catalogue".
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Card, Icon, Txt } from "@/components";
import { rebuildLeagueReadModels } from "@/lib/league";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { withAlpha } from "@/lib/color";
import { colors, radius, spacing } from "@/theme";
import { SectionHead } from "./SectionHead";

export function MaintenanceSection({ onDone }: { onDone?: () => void }) {
  const [recalculating, setRecalculating] = useState(false);

  function confirmRecalc() {
    confirmAction({
      title: "Recalculate every rating?",
      message:
        "Replays every confirmed match across all seasons under the current ELO model, including team-strength handicaps. Standings and rating history are rewritten for everyone. Update the team catalogue first so team ratings are current.",
      confirmLabel: "Recalculate",
      destructive: true,
      onConfirm: async () => {
        setRecalculating(true);
        try {
          const result = await rebuildLeagueReadModels();
          toast.success(
            `${result.queued ? "Recalculation queued" : "Ratings recalculated"}: ${result.matchCount} matches across ${result.seasonCount} season${
              result.seasonCount === 1 ? "" : "s"
            }`,
          );
          onDone?.();
        } catch (e: unknown) {
          showAlert("Couldn't recalculate ratings", callableErrorMessage(e));
        } finally {
          setRecalculating(false);
        }
      },
    });
  }

  return (
    <View>
      <SectionHead title="Maintenance" subtitle="League-wide operations. Use with care." />
      <Card style={styles.danger}>
        <View style={styles.dangerHead}>
          <Icon name="info" size={16} color={colors.loss} />
          <Txt variant="head" size={12} color={colors.loss} style={{ letterSpacing: 1.2 }}>
            DANGER ZONE
          </Txt>
        </View>
        <View style={styles.op}>
          <View style={styles.opIcon}>
            <Icon name="refresh" size={18} color={colors.loss} />
          </View>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Txt variant="head" size={14.5}>
              Recalculate ELO
            </Txt>
            <Txt size={12.5} color={colors.textDim} style={{ marginTop: 3, lineHeight: 18 }}>
              Replays every confirmed match from scratch and rewrites standings and rating history.
              Only needed after a rating-model change or a catalogue update.
            </Txt>
          </View>
          <Button variant="danger" size="sm" loading={recalculating} onPress={confirmRecalc}>
            {recalculating ? "Recalculating…" : "Recalculate"}
          </Button>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  danger: {
    borderColor: withAlpha(colors.loss, 0.35),
    backgroundColor: withAlpha(colors.loss, 0.03),
  },
  dangerHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  op: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  opIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.loss, 0.1),
  },
});
