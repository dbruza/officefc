/**
 * Admin → Teams: search the catalogue (~700 teams), add custom teams, rename, hide and
 * restore, and pull in the bundled catalogue. The list renders 50 rows at a time —
 * rendering the whole catalogue at once froze the screen on phones.
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorCard,
  Grid,
  Segmented,
  SkeletonRows,
  Tag,
  TextField,
  Txt,
} from "@/components";
import { Form, submitOnEnter } from "@/components/FormScreen";
import { manageTeam, seedTeams, getTeams, type Team } from "@/lib/league";
import { colors, spacing } from "@/theme";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { SectionHead } from "./SectionHead";

const PAGE = 50;

type Filter = "active" | "hidden" | "custom" | "all";

function matchesFilter(team: Team, filter: Filter): boolean {
  if (filter === "active") return team.active;
  if (filter === "hidden") return !team.active;
  if (filter === "custom") return team.source === "custom";
  return true;
}

export function TeamsSection() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [limit, setLimit] = useState(PAGE);

  const load = async () => {
    setLoading(true);
    try {
      setTeams(await getTeams(true));
      setError(null);
    } catch {
      setError("Couldn't load the teams. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // A new search or filter starts from the top of the list again.
  useEffect(() => setLimit(PAGE), [search, filter]);

  const counts = useMemo(() => {
    const all = teams ?? [];
    return {
      active: all.filter((t) => t.active).length,
      hidden: all.filter((t) => !t.active).length,
      custom: all.filter((t) => t.source === "custom").length,
      all: all.length,
    };
  }, [teams]);

  const visibleTeams = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (teams ?? []).filter(
      (team) =>
        matchesFilter(team, filter) &&
        (!query ||
          team.name.toLowerCase().includes(query) ||
          team.competition.toLowerCase().includes(query)),
    );
  }, [teams, search, filter]);

  function confirmSync() {
    confirmAction({
      title: "Update team catalogue",
      message:
        "Switch the picker to the bundled team catalogue? Teams it no longer lists are retired but keep their ratings on past matches. Custom teams stay, and renamed or hidden teams carry over to the same club in the new catalogue.",
      confirmLabel: "Update",
      onConfirm: async () => {
        setSyncing(true);
        try {
          const result = await seedTeams();
          showAlert(
            `Catalogue ${result.version} updated`,
            `${result.updated} updated · ${result.deleted} removed · ${result.deactivated} superseded · ${result.overridesCarried ?? 0} overrides carried · ${result.active} active.`,
          );
          void load();
        } catch (e: unknown) {
          showAlert("Couldn't update the catalogue", callableErrorMessage(e));
        } finally {
          setSyncing(false);
        }
      },
    });
  }

  async function doAdd() {
    const name = newTeamName.trim();
    if (!name || savingNew) return;
    setSavingNew(true);
    try {
      await manageTeam("add", name);
      toast.success(`Added ${name}`);
      setAdding(false);
      setNewTeamName("");
      setFilter("custom");
      void load();
    } catch (e: unknown) {
      showAlert("Couldn't add the team", callableErrorMessage(e));
    } finally {
      setSavingNew(false);
    }
  }

  async function doRename(teamId: string) {
    const name = renameName.trim();
    if (!name || savingRename) return;
    setSavingRename(true);
    try {
      await manageTeam("rename", teamId, name);
      toast.success(`Renamed to ${name}`);
      setRenaming(null);
      void load();
    } catch (e: unknown) {
      showAlert("Couldn't rename the team", callableErrorMessage(e));
    } finally {
      setSavingRename(false);
    }
  }

  function doDeactivate(team: Team) {
    confirmAction({
      title: `Hide ${team.name}?`,
      message:
        "It disappears from the team picker. Past matches keep it, and you can restore it from the Hidden filter.",
      confirmLabel: "Hide team",
      destructive: true,
      onConfirm: async () => {
        setRowBusy(team.id);
        try {
          await manageTeam("deactivate", team.id);
          toast.success(`${team.name} hidden`);
          void load();
        } catch (e: unknown) {
          showAlert("Couldn't hide the team", callableErrorMessage(e));
        } finally {
          setRowBusy(null);
        }
      },
    });
  }

  async function doReactivate(team: Team) {
    setRowBusy(team.id);
    try {
      await manageTeam("reactivate", team.id);
      toast.success(`${team.name} restored`);
      void load();
    } catch (e: unknown) {
      showAlert("Couldn't restore the team", callableErrorMessage(e));
    } finally {
      setRowBusy(null);
    }
  }

  const shown = visibleTeams.slice(0, limit);

  return (
    <View>
      <SectionHead
        title="Teams"
        subtitle="What players can pick when logging a match."
        action={
          adding ? null : (
            <Button size="sm" icon="plus" onPress={() => setAdding(true)}>
              Add team
            </Button>
          )
        }
      />

      {adding ? (
        <Card style={styles.formCard}>
          <View style={{ gap: spacing.md }}>
            <Form onSubmit={() => void doAdd()}>
              <TextField
                label="Custom team name"
                value={newTeamName}
                onChangeText={setNewTeamName}
                placeholder="e.g. Office XI"
                autoComplete="off"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitOnEnter(() => void doAdd())}
                hint="Custom teams are unrated: they don't adjust ELO for team strength."
              />
              <View style={styles.row}>
                <Button
                  size="sm"
                  loading={savingNew}
                  disabled={!newTeamName.trim()}
                  onPress={() => void doAdd()}
                >
                  Add team
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={savingNew}
                  onPress={() => {
                    setAdding(false);
                    setNewTeamName("");
                  }}
                >
                  Cancel
                </Button>
              </View>
            </Form>
          </View>
        </Card>
      ) : null}

      <Card style={styles.toolCard}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Txt variant="head" size={13.5}>
            Team catalogue
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2, lineHeight: 17 }}>
            Pull the bundled catalogue into the picker. Renames and hidden teams carry over.
          </Txt>
        </View>
        <Button size="sm" variant="dark" icon="download" loading={syncing} onPress={confirmSync}>
          Update catalogue
        </Button>
      </Card>

      <View style={styles.filters}>
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Search team or competition"
          accessibilityLabel="Search teams"
          autoComplete="off"
          autoCorrect={false}
          inputMode="search"
        />
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: `Active ${counts.active}` },
            { value: "hidden", label: `Hidden ${counts.hidden}` },
            { value: "custom", label: `Custom ${counts.custom}` },
            { value: "all", label: `All ${counts.all}` },
          ]}
        />
        <Txt size={11.5} color={colors.textDim}>
          {teams === null
            ? "Loading teams…"
            : `Showing ${Math.min(limit, visibleTeams.length)} of ${visibleTeams.length}${
                visibleTeams.length !== counts.all ? ` (${counts.all} total)` : ""
              }`}
        </Txt>
      </View>

      {teams === null && error ? (
        <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />
      ) : teams === null ? (
        <SkeletonRows count={6} height={64} />
      ) : visibleTeams.length === 0 ? (
        <EmptyState
          compact
          icon="search"
          title={search.trim() ? `No teams match “${search.trim()}”` : "Nothing here"}
          body={search.trim() ? "Try another name, or switch the filter to All." : undefined}
        />
      ) : (
        <>
          <Grid min={360} maxColumns={2} gap={spacing.sm}>
            {shown.map((team) =>
              renaming === team.id ? (
                <Card key={team.id} style={styles.renameCard}>
                  <View style={{ gap: spacing.sm }}>
                    <Form onSubmit={() => void doRename(team.id)}>
                      <TextField
                        label={`Rename ${team.name}`}
                        value={renameName}
                        onChangeText={setRenameName}
                        autoComplete="off"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={submitOnEnter(() => void doRename(team.id))}
                      />
                      <View style={styles.row}>
                        <Button
                          size="sm"
                          loading={savingRename}
                          disabled={!renameName.trim()}
                          onPress={() => void doRename(team.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={savingRename}
                          onPress={() => setRenaming(null)}
                        >
                          Cancel
                        </Button>
                      </View>
                    </Form>
                  </View>
                </Card>
              ) : (
                <TeamRow
                  key={team.id}
                  team={team}
                  busy={rowBusy === team.id}
                  onRename={() => {
                    setRenaming(team.id);
                    setRenameName(team.name);
                  }}
                  onDeactivate={() => doDeactivate(team)}
                  onReactivate={() => void doReactivate(team)}
                />
              ),
            )}
          </Grid>
          {visibleTeams.length > limit ? (
            <Button
              variant="ghost"
              icon="plus"
              style={{ alignSelf: "center", marginTop: spacing.lg }}
              onPress={() => setLimit((n) => n + PAGE)}
            >
              {`Show ${Math.min(PAGE, visibleTeams.length - limit)} more`}
            </Button>
          ) : null}
        </>
      )}

      {teams !== null && error ? (
        <ErrorCard
          message={error}
          onRetry={() => void load()}
          retrying={loading}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

function TeamRow({
  team,
  busy,
  onRename,
  onDeactivate,
  onReactivate,
}: {
  team: Team;
  busy: boolean;
  onRename: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  return (
    <Card style={[styles.teamRow, !team.active && { opacity: 0.75 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.teamTitle}>
          <Txt variant="bodyMedium" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {team.name}
          </Txt>
          {team.source === "custom" ? <Tag>CUSTOM</Tag> : null}
          {!team.active ? <Tag tone="loss">HIDDEN</Tag> : null}
        </View>
        <Txt size={11} color={colors.textDim} style={{ marginTop: 3 }} numberOfLines={1}>
          {team.competition || "Legacy catalogue entry"}
          {team.source === "custom"
            ? " · unrated"
            : ` · ${team.catalogueVersion?.toUpperCase() ?? "LEGACY"} · OVR ${team.overall ?? "N/A"}`}
        </Txt>
      </View>
      <View style={styles.row}>
        <Button
          size="sm"
          variant="ghost"
          icon="edit"
          disabled={busy}
          onPress={onRename}
          accessibilityLabel={`Rename ${team.name}`}
        >
          Rename
        </Button>
        {team.active ? (
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onPress={onDeactivate}
            accessibilityLabel={`Hide ${team.name}`}
          >
            Hide
          </Button>
        ) : team.catalogueActive ? (
          <Button
            size="sm"
            variant="dark"
            loading={busy}
            onPress={onReactivate}
            accessibilityLabel={`Restore ${team.name}`}
          >
            Restore
          </Button>
        ) : (
          <Txt size={10.5} color={colors.textFaint} style={{ alignSelf: "center" }}>
            Superseded
          </Txt>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  formCard: { borderColor: colors.lineStrong, marginBottom: spacing.lg },
  renameCard: { borderColor: colors.lineStrong },
  toolCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  filters: { gap: spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 12,
  },
  teamTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
});
