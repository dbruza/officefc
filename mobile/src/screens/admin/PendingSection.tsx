/**
 * Admin → Results: every pending or disputed match, disputes first. The queue is loaded by
 * the admin screen (the overview card counts the same list), so this only renders it —
 * skeletons while loading, an error card on failure, and "all clear" only when it truly is.
 */
import { useMemo } from "react";
import { View } from "react-native";
import { EmptyState, ErrorCard, Grid, Reveal, SkeletonCard } from "@/components";
import type { AdminPendingMatch, LeaguePlayer } from "@/lib/league";
import { spacing } from "@/theme";
import { AdminMatchCard } from "./AdminMatchCard";
import { SectionHead } from "./SectionHead";

export function PendingSection({
  matches,
  players,
  loading,
  error,
  reload,
}: {
  matches: AdminPendingMatch[] | null;
  players: Map<string, LeaguePlayer>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<unknown>;
}) {
  // Disputes need a human; plain pendings auto-confirm eventually. Oldest first within each.
  const sorted = useMemo(
    () =>
      [...(matches ?? [])].sort(
        (a, b) =>
          Number(b.status === "disputed") - Number(a.status === "disputed") ||
          (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0),
      ),
    [matches],
  );
  const disputed = sorted.filter((m) => m.status === "disputed").length;

  return (
    <View>
      <SectionHead
        title="Results to review"
        subtitle={
          matches && matches.length > 0
            ? `${matches.length} waiting${disputed ? ` · ${disputed} disputed` : ""}. Disputes are listed first.`
            : "Pending and disputed results land here."
        }
      />

      {matches === null && error ? (
        <ErrorCard message={error} onRetry={() => void reload()} retrying={loading} />
      ) : matches === null ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard height={150} />
          <SkeletonCard height={150} />
        </View>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="check"
          title="All caught up"
          body="No pending or disputed results. New disputes show up here with a badge."
        />
      ) : (
        <Grid min={360} maxColumns={2} gap={spacing.md}>
          {sorted.map((m, i) => (
            <Reveal key={m.id} index={i}>
              <AdminMatchCard match={m} players={players} onResolved={() => void reload()} />
            </Reveal>
          ))}
        </Grid>
      )}

      {matches !== null && error ? (
        <ErrorCard
          message={error}
          onRetry={() => void reload()}
          retrying={loading}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}
