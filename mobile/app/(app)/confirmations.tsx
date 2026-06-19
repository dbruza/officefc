import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Avatar, Button, Card, Icon, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  confirmMatch,
  disputeMatch,
  getLeaguePlayers,
  type LeaguePlayer,
  type PendingMatch,
} from "@/lib/league";
import { usePendingConfirmations } from "@/lib/usePendingConfirmations";
import { colors, spacing } from "@/theme";
import type { Player } from "@/types";

export default function Confirmations() {
  const router = useRouter();
  const { user } = useAuth();
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { matches, loaded: pendingLoaded } = usePendingConfirmations(user?.uid, {
    onError: () => setError("The live confirmation inbox disconnected. Refocus the tab to retry."),
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const roster = await getLeaguePlayers();
      setPlayers(new Map(roster.map((player) => [player.id, player])));
    } catch {
      setError("Couldn't load confirmations. Check the emulators and try again.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function resolve(match: PendingMatch, action: "confirm" | "dispute") {
    setBusyId(match.id);
    setError(null);
    try {
      if (action === "confirm") await confirmMatch(match.id);
      else await disputeMatch(match.id, "Opponent disputed the submitted result.");
      // The live listener drops the row once the backend moves the match out of
      // pending_confirmation; no optimistic local mutation (which would race the listener).
    } catch {
      setError("That result couldn't be updated. It may already have been resolved.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={20} />
        </Pressable>
        <View>
          <Txt variant="head" size={22}>
            Confirm results
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            Only your opponent can put a result into the table.
          </Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading || !pendingLoaded ? <ActivityIndicator color={colors.accent} /> : null}
        {!loading && pendingLoaded && matches.length === 0 ? (
          <Card style={styles.empty}>
            <Icon name="check" size={28} color={colors.accent} />
            <Txt variant="head" size={18} style={{ marginTop: spacing.md }}>
              Inbox clear
            </Txt>
            <Txt color={colors.textDim} style={{ textAlign: "center", marginTop: spacing.sm }}>
              No results are waiting for your confirmation.
            </Txt>
          </Card>
        ) : null}
        {matches.map((match) => {
          const meIsA = match.aId === user?.uid;
          const opponentId = meIsA ? match.bId : match.aId;
          const opponent = players.get(opponentId);
          const me = players.get(user?.uid ?? "");
          return (
            <MatchCard
              key={match.id}
              match={match}
              me={me}
              opponent={opponent}
              meIsA={meIsA}
              busy={busyId === match.id}
              onConfirm={() => resolve(match, "confirm")}
              onDispute={() => resolve(match, "dispute")}
            />
          );
        })}
        {error ? (
          <Txt color={colors.loss} style={{ marginTop: spacing.md }}>
            {error}
          </Txt>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MatchCard({
  match,
  me,
  opponent,
  meIsA,
  busy,
  onConfirm,
  onDispute,
}: {
  match: PendingMatch;
  me?: Player;
  opponent?: Player;
  meIsA: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDispute: () => void;
}) {
  const myGoals = meIsA ? match.aGoals : match.bGoals;
  const opponentGoals = meIsA ? match.bGoals : match.aGoals;
  const myTeam = meIsA ? match.aTeam : match.bTeam;
  const opponentTeam = meIsA ? match.bTeam : match.aTeam;

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.pendingRow}>
        <View style={styles.pendingDot} />
        <Txt variant="head" size={10.5} color={colors.textDim}>
          WAITING FOR YOUR VERDICT
        </Txt>
      </View>
      <View style={styles.scoreRow}>
        <Side player={me} label="You" team={myTeam} />
        <Txt variant="monoBold" size={38}>
          {myGoals}
          <Txt variant="monoBold" size={38} color={colors.textFaint}>
            :
          </Txt>
          {opponentGoals}
        </Txt>
        <Side
          player={opponent}
          label={opponent?.name.split(" ")[0] ?? "Opponent"}
          team={opponentTeam}
        />
      </View>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button full variant="danger" disabled={busy} onPress={onDispute}>
            Dispute
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button full icon="check" disabled={busy} onPress={onConfirm}>
            {busy ? "Updating…" : "Confirm"}
          </Button>
        </View>
      </View>
    </Card>
  );
}

function Side({ player, label, team }: { player?: Player; label: string; team: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Avatar player={player} size={44} jersey />
      <Txt variant="bodyMedium" size={12.5} style={{ marginTop: spacing.sm }}>
        {label}
      </Txt>
      <Txt size={10} color={colors.textDim} numberOfLines={1} style={{ marginTop: 2 }}>
        {team}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  empty: { alignItems: "center", paddingVertical: spacing.x3 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pendingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginVertical: spacing.x2,
  },
  actions: { flexDirection: "row", gap: spacing.sm },
});
