import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, TextInput, View } from "react-native";
import { Button, Card, Txt } from "@/components";
import { manageTeam, seedTeams, rebuildLeagueReadModels, getTeams, type Team } from "@/lib/league";
import { colors, spacing } from "@/theme";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { errorMessage, formStyles } from "./common";

export function TeamsSection() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const t = await getTeams(true);
      setTeams(t);
      setError(null);
    } catch {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleTeams = teams.filter((team) => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      team.name.toLowerCase().includes(query) ||
      team.competition.toLowerCase().includes(query)
    );
  });

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
          load();
        } catch (error: unknown) {
          showAlert("Error", errorMessage(error));
        } finally {
          setSyncing(false);
        }
      },
    });
  }

  function confirmRecalc() {
    confirmAction({
      title: "Recalculate ELO",
      message:
        "Replay every confirmed match across all seasons under the current ELO model, including team-strength handicaps. Standings and rating history will be rewritten. Sync the catalogue first so team ratings are current.",
      confirmLabel: "Recalculate",
      onConfirm: async () => {
        setRecalculating(true);
        try {
          const result = await rebuildLeagueReadModels();
          showAlert(
            "ELO recalculated",
            `${result.matchCount} matches across ${result.seasonCount} season(s) replayed.`,
          );
          load();
        } catch (error: unknown) {
          showAlert("Error", errorMessage(error));
        } finally {
          setRecalculating(false);
        }
      },
    });
  }

  async function doAdd() {
    if (!newTeamName) return;
    try {
      await manageTeam("add", newTeamName);
      setAdding(false);
      setNewTeamName("");
      load();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    }
  }

  async function doRename(teamId: string) {
    if (!renameName) return;
    try {
      await manageTeam("rename", teamId, renameName);
      setRenaming(null);
      load();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    }
  }

  async function doDeactivate(teamId: string, name: string) {
    confirmAction({
      title: "Deactivate",
      message: `Deactivate ${name}?`,
      confirmLabel: "Deactivate",
      destructive: true,
      onConfirm: async () => {
        await manageTeam("deactivate", teamId);
        load();
      },
    });
  }

  async function doReactivate(teamId: string) {
    try {
      await manageTeam("reactivate", teamId);
      load();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    }
  }

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>
        Teams
      </Txt>

      {adding ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <TextInput
            value={newTeamName}
            onChangeText={setNewTeamName}
            placeholder="Team name"
            placeholderTextColor={colors.textFaint}
            style={formStyles.input}
          />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Button size="sm" onPress={doAdd}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setAdding(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          size="md"
          icon="plus"
          onPress={() => setAdding(true)}
          style={{ marginBottom: spacing.sm }}
        >
          Add Team
        </Button>
      )}

      <Button
        size="md"
        variant="dark"
        icon="bolt"
        onPress={confirmSync}
        disabled={syncing}
        style={{ marginBottom: spacing.lg }}
      >
        {syncing ? "Updating…" : "Update team catalogue"}
      </Button>

      <Button
        size="md"
        variant="dark"
        icon="bolt"
        onPress={confirmRecalc}
        disabled={recalculating}
        style={{ marginBottom: spacing.lg }}
      >
        {recalculating ? "Recalculating…" : "Recalculate ELO"}
      </Button>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search team or competition"
        placeholderTextColor={colors.textFaint}
        style={formStyles.input}
      />
      <Txt size={11.5} color={colors.textDim} style={{ marginBottom: spacing.md }}>
        {visibleTeams.length} of {teams.length} teams
      </Txt>

      {loading ? <ActivityIndicator color={colors.accent} /> : null}

      <FlatList
        data={visibleTeams}
        scrollEnabled={false}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) =>
          renaming === item.id ? (
            <Card style={{ marginBottom: spacing.sm }}>
              <TextInput
                value={renameName}
                onChangeText={setRenameName}
                placeholder="New name"
                placeholderTextColor={colors.textFaint}
                style={formStyles.input}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                <Button size="sm" onPress={() => doRename(item.id)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setRenaming(null)}>
                  Cancel
                </Button>
              </View>
            </Card>
          ) : (
            <Card key={item.id} style={{ marginBottom: spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Txt variant="bodyMedium" size={14}>
                    {item.name}
                  </Txt>
                  <Txt size={10.5} color={colors.textDim} style={{ marginTop: 3 }}>
                    {item.competition || "Legacy catalogue entry"}
                  </Txt>
                  <Txt variant="mono" size={10} color={colors.textFaint} style={{ marginTop: 4 }}>
                    {item.source === "custom"
                      ? "CUSTOM · UNRATED"
                      : `${item.catalogueVersion?.toUpperCase() ?? "LEGACY"} · OVR ${
                          item.overall ?? "N/A"
                        }`}
                    {" · "}
                    {item.active ? "ACTIVE" : "INACTIVE"}
                  </Txt>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setRenaming(item.id);
                      setRenameName(item.name);
                    }}
                  >
                    Rename
                  </Button>
                  {item.active ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onPress={() => doDeactivate(item.id, item.name)}
                    >
                      Deactivate
                    </Button>
                  ) : item.catalogueActive ? (
                    <Button size="sm" variant="dark" onPress={() => doReactivate(item.id)}>
                      Reactivate
                    </Button>
                  ) : (
                    <Txt size={10.5} color={colors.textFaint}>
                      Superseded
                    </Txt>
                  )}
                </View>
              </View>
            </Card>
          )
        }
      />

      {error ? (
        <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}
