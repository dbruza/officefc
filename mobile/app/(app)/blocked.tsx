/** Settings → Blocked players: the one place blocked players show by name, to unblock them. */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorCard,
  Page,
  Reveal,
  ScreenHeader,
  SkeletonRows,
  Txt,
} from "@/components";
import { getBlockedPlayers, setPlayerBlocked, type BlockedPlayer } from "@/lib/league";
import { useFocusData } from "@/lib/useFocusData";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { colors, spacing } from "@/theme";

export default function BlockedPlayers() {
  const { data, loading, error, reload } = useFocusData<BlockedPlayer[]>(
    "blocked-players",
    useCallback(() => getBlockedPlayers(), []),
  );
  const [busy, setBusy] = useState<string | null>(null);

  function unblock(player: BlockedPlayer) {
    confirmAction({
      title: `Unblock ${player.name}?`,
      message: "Their name, photos and activity show again, and you can play each other.",
      confirmLabel: "Unblock",
      onConfirm: async () => {
        setBusy(player.id);
        try {
          await setPlayerBlocked(player.id, false);
          toast.success(`${player.name} unblocked`);
          await reload();
        } catch (e: unknown) {
          showAlert("Couldn't unblock", callableErrorMessage(e));
        } finally {
          setBusy(null);
        }
      },
    });
  }

  let body;
  if (!data) {
    body =
      loading || !error ? (
        <SkeletonRows count={2} />
      ) : (
        <ErrorCard message="Couldn't load your blocked players." onRetry={() => void reload()} />
      );
  } else if (data.length === 0) {
    body = (
      <EmptyState
        icon="shield"
        title="Nobody blocked"
        body="To block someone, open their profile and tap the shield."
      />
    );
  } else {
    body = (
      <Card padded={false}>
        {data.map((player, index) => (
          <View
            key={player.id}
            style={[styles.row, index < data.length - 1 ? styles.divider : null]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="bodyMedium" size={14.5} numberOfLines={1}>
                {player.name}
              </Txt>
              {player.handle ? (
                <Txt size={12} color={colors.textDim} numberOfLines={1}>
                  @{player.handle}
                </Txt>
              ) : null}
            </View>
            <Button
              variant="ghost"
              size="sm"
              loading={busy === player.id}
              onPress={() => unblock(player)}
            >
              Unblock
            </Button>
          </View>
        ))}
      </Card>
    );
  }

  return (
    <Page
      width="narrow"
      header={
        <ScreenHeader
          title="Blocked players"
          subtitle="Hidden from you, and you can't play each other."
          back
        />
      }
    >
      <Reveal>{body}</Reveal>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
});
