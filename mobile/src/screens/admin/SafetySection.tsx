/**
 * Admin → Safety: player reports (from the report and block buttons, plus names the server
 * took down) and removed members. Apple expects reports acted on within 24 hours — every
 * new report pushes the admins, and a tapped push opens this section.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Avatar, Button, Card, EmptyState, ErrorCard, SkeletonRows, Tag, Txt } from "@/components";
import {
  REPORT_REASON_LABELS,
  getLeaguePlayers,
  getReports,
  moderateMember,
  resolveReport,
  type LeaguePlayer,
  type ModerationAction,
  type PlayerReport,
} from "@/lib/league";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { timeAgo } from "@/lib/when";
import { colors, spacing } from "@/theme";
import { SectionHead } from "./SectionHead";

const SOURCE_LABEL: Record<PlayerReport["source"], string> = {
  user: "Reported",
  block: "Blocked",
  auto: "Auto-filtered",
};

export function SafetySection() {
  const router = useRouter();
  const [reports, setReports] = useState<PlayerReport[] | null>(null);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, roster] = await Promise.all([getReports(), getLeaguePlayers()]);
      setReports(list);
      setPlayers(new Map(roster.map((player) => [player.id, player])));
      setError(null);
    } catch {
      setError("Couldn't load reports. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(() => (reports ?? []).filter((r) => r.status === "open"), [reports]);
  const removed = useMemo(
    () => [...players.values()].filter((player) => player.status === "removed"),
    [players],
  );
  const nameOf = (uid: string) =>
    uid === "system" ? "OfficeFC" : (players.get(uid)?.name ?? "Former player");

  async function run(key: string, failTitle: string, success: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (e: unknown) {
      showAlert(failTitle, callableErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function moderate(report: PlayerReport | null, targetId: string, action: ModerationAction) {
    const name = nameOf(targetId);
    const copy = {
      remove: {
        title: `Remove ${name} from the league?`,
        message:
          "They lose access straight away and their join code stops working for them. Their past results stay on the table. You can reinstate them later.",
        label: "Remove",
        done: `${name} removed`,
      },
      reset_name: {
        title: `Replace ${name}'s name?`,
        message:
          "Their name and handle become a neutral “Player” name. They can choose a new one, which is screened again.",
        label: "Replace name",
        done: "Name replaced",
      },
      reinstate: {
        title: `Reinstate ${name}?`,
        message: "They get their league access back.",
        label: "Reinstate",
        done: `${name} reinstated`,
      },
    }[action];
    confirmAction({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.label,
      destructive: action === "remove",
      onConfirm: () =>
        run(`${report?.id ?? targetId}:${action}`, "Couldn't do that", copy.done, async () => {
          await moderateMember(targetId, action);
          if (report) await resolveReport(report.id, "actioned");
        }),
    });
  }

  if (loading && !reports) return <SkeletonRows count={3} height={96} />;
  if (error && !reports) return <ErrorCard message={error} onRetry={() => void load()} />;

  return (
    <View style={{ gap: spacing.x2 }}>
      <View>
        <SectionHead
          title="Reports"
          subtitle="Act on each report within 24 hours: replace the name, remove the player, or dismiss it."
        />
        {open.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No open reports"
            body="Reports from players, blocks and auto-filtered names appear here."
            compact
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {open.map((report) => {
              const target = players.get(report.targetId);
              const removedAlready = target?.status !== "active";
              return (
                <Card key={report.id}>
                  <View style={styles.head}>
                    {target ? <Avatar player={target} size={36} /> : null}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="head" size={14.5} numberOfLines={1}>
                        {nameOf(report.targetId)}
                      </Txt>
                      <Txt size={12} color={colors.textDim} numberOfLines={1}>
                        {SOURCE_LABEL[report.source]} by {nameOf(report.reporterId)} ·{" "}
                        {timeAgo(report.createdAt)}
                      </Txt>
                    </View>
                    <Tag tone="loss">
                      {(REPORT_REASON_LABELS[report.reason] ?? "Report").toUpperCase()}
                    </Tag>
                  </View>
                  {report.details ? (
                    <Txt size={13} style={styles.details} selectable>
                      {report.details}
                    </Txt>
                  ) : null}
                  <View style={styles.actions}>
                    {report.matchId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="arrowRight"
                        onPress={() => router.push(`/(app)/match/${report.matchId}`)}
                      >
                        Open match
                      </Button>
                    ) : null}
                    <Button
                      variant="dark"
                      size="sm"
                      loading={busy === `${report.id}:reset_name`}
                      disabled={!target || removedAlready}
                      onPress={() => moderate(report, report.targetId, "reset_name")}
                    >
                      Replace name
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy === `${report.id}:remove`}
                      disabled={!target || removedAlready}
                      onPress={() => moderate(report, report.targetId, "remove")}
                    >
                      Remove player
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `${report.id}:dismiss`}
                      onPress={() =>
                        void run(
                          `${report.id}:dismiss`,
                          "Couldn't dismiss",
                          "Report dismissed",
                          () => resolveReport(report.id, "dismissed"),
                        )
                      }
                    >
                      Dismiss
                    </Button>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </View>

      <View>
        <SectionHead title="Removed players" subtitle="No access until reinstated." />
        {removed.length === 0 ? (
          <Txt size={13} color={colors.textDim}>
            Nobody has been removed.
          </Txt>
        ) : (
          <Card padded={false}>
            {removed.map((player, index) => (
              <View
                key={player.id}
                style={[styles.row, index < removed.length - 1 ? styles.divider : null]}
              >
                <Avatar player={player} size={32} />
                <Txt variant="bodyMedium" size={14} style={{ flex: 1 }} numberOfLines={1}>
                  {player.name}
                </Txt>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === `${player.id}:reinstate`}
                  onPress={() => moderate(null, player.id, "reinstate")}
                >
                  Reinstate
                </Button>
              </View>
            ))}
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  details: { marginTop: spacing.md, lineHeight: 19 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
});
