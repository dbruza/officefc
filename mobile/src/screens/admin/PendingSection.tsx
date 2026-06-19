import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Txt } from "@/components";
import {
  getAdminPendingMatches,
  getLeaguePlayers,
  type AdminPendingMatch,
  type LeaguePlayer,
} from "@/lib/league";
import { colors, spacing } from "@/theme";
import { AdminMatchCard } from "./AdminMatchCard";

export function PendingSection() {
  const [matches, setMatches] = useState<AdminPendingMatch[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [p, roster] = await Promise.all([getAdminPendingMatches(), getLeaguePlayers()]);
      setMatches(p);
      setPlayers(new Map(roster.map((player) => [player.id, player])));
      setError(null);
    } catch {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>
        Pending & Disputed
      </Txt>

      {loading ? <ActivityIndicator color={colors.accent} /> : null}

      {matches.length === 0 ? (
        <Txt color={colors.textDim}>No pending matches.</Txt>
      ) : (
        matches.map((m) => (
          <AdminMatchCard key={m.id} match={m} players={players} onResolved={reload} />
        ))
      )}

      {error ? (
        <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}
