import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Card, Icon, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import {
  createSeason,
  activateSeason,
  finalizeSeason,
  manageTeam,
  seedTeams,
  resolveMatch,
  listSeasons,
  getTeams,
  getAdminPendingMatches,
  getLeaguePlayers,
  getMatchPhotoUrl,
  type Team,
  type AdminPendingMatch,
  type LeaguePlayer,
} from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { firstName } from "@/lib/format";
import { confirmAction, showAlert } from "@/lib/dialogs";

type Section = "seasons" | "teams" | "pending";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function AdminScreen() {
  const router = useRouter();
  const { membership } = useAuth();
  const [section, setSection] = useState<Section>("seasons");
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState<
    Array<{ id: string; name: string; active: boolean; finalized: boolean }>
  >([]);
  const [teams, setTeamsList] = useState<Team[]>([]);
  const [pending, setPending] = useState<AdminPendingMatch[]>([]);
  const [players, setPlayers] = useState<Map<string, LeaguePlayer>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const isAdmin = membership?.role === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const [s, t, p, roster] = await Promise.all([
        listSeasons(),
        getTeams(true),
        getAdminPendingMatches(),
        getLeaguePlayers(),
      ]);
      setSeasons(s);
      setTeamsList(t);
      setPending(p);
      setPlayers(new Map(roster.map((player) => [player.id, player])));
    } catch {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.center}>
          <Txt variant="head" size={18}>
            Admin only
          </Txt>
          <Txt color={colors.textDim} style={{ marginTop: spacing.sm }}>
            You need admin privileges.
          </Txt>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="x" size={20} stroke={2.5} />
        </Pressable>
        <Txt variant="head" size={18}>
          Admin
        </Txt>
      </View>

      <View style={styles.tabs}>
        {(["seasons", "teams", "pending"] as Section[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => setSection(s)}
            style={[styles.tab, section === s && styles.tabActive]}
          >
            <Txt size={13} color={section === s ? colors.accent : colors.textDim}>
              {s === "seasons" ? "Seasons" : s === "teams" ? "Teams" : "Pending"}
            </Txt>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {section === "seasons" ? <SeasonsSection seasons={seasons} onReload={load} /> : null}
          {section === "teams" ? <TeamsSection teams={teams} onReload={load} /> : null}
          {section === "pending" ? (
            <PendingSection matches={pending} players={players} onReload={load} />
          ) : null}

          {error ? (
            <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
              {error}
            </Txt>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SeasonsSection({
  seasons,
  onReload,
}: {
  seasons: Array<{ id: string; name: string; active: boolean; finalized: boolean }>;
  onReload: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  async function doCreate() {
    if (!newName) return;
    try {
      await createSeason(
        newName,
        newStart || new Date().toISOString(),
        newEnd || new Date(Date.now() + 90 * 86400000).toISOString(),
      );
      setCreating(false);
      setNewName("");
      setNewStart("");
      setNewEnd("");
      onReload();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    }
  }

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>
        Seasons
      </Txt>

      {creating ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Txt variant="head" size={13} style={{ marginBottom: spacing.md }}>
            New Season
          </Txt>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Name (e.g. Summer 2027)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          <TextInput
            value={newStart}
            onChangeText={setNewStart}
            placeholder="Start (ISO date)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          <TextInput
            value={newEnd}
            onChangeText={setNewEnd}
            placeholder="End (ISO date)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Button size="sm" onPress={doCreate}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setCreating(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          size="md"
          icon="plus"
          onPress={() => setCreating(true)}
          style={{ marginBottom: spacing.lg }}
        >
          New Season
        </Button>
      )}

      {seasons.map((s) => (
        <Card key={s.id} style={{ marginBottom: spacing.sm }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <View>
              <Txt variant="bodyMedium" size={14}>
                {s.name}
              </Txt>
              <Txt size={11} color={colors.textDim} style={{ marginTop: 2 }}>
                {s.active ? "Active" : s.finalized ? "Finalized" : "Inactive"}
              </Txt>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {!s.active && !s.finalized ? (
                <Button
                  size="sm"
                  variant="dark"
                  onPress={async () => {
                    await activateSeason(s.id);
                    onReload();
                  }}
                >
                  Activate
                </Button>
              ) : null}
              {s.active ? (
                <Button
                  size="sm"
                  variant="dark"
                  onPress={async () => {
                    await finalizeSeason(s.id);
                    onReload();
                  }}
                >
                  Finalize
                </Button>
              ) : null}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

function TeamsSection({ teams, onReload }: { teams: Team[]; onReload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

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
      title: "Update FIFA catalogue",
      message:
        "Update to the bundled FIFA catalogue version? Custom teams and admin overrides will be preserved.",
      confirmLabel: "Update",
      onConfirm: async () => {
        setSyncing(true);
        try {
          const result = await seedTeams();
          showAlert(
            `Catalogue ${result.version} updated`,
            `${result.updated} updated · ${result.deleted} removed · ${result.deactivated} superseded · ${result.active} active.`,
          );
          onReload();
        } catch (error: unknown) {
          showAlert("Error", errorMessage(error));
        } finally {
          setSyncing(false);
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
      onReload();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    }
  }

  async function doRename(teamId: string) {
    if (!renameName) return;
    try {
      await manageTeam("rename", teamId, renameName);
      setRenaming(null);
      onReload();
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
        onReload();
      },
    });
  }

  async function doReactivate(teamId: string) {
    try {
      await manageTeam("reactivate", teamId);
      onReload();
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
            style={styles.input}
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
        {syncing ? "Updating…" : "Update FIFA catalogue"}
      </Button>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search team or competition"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
      />
      <Txt size={11.5} color={colors.textDim} style={{ marginBottom: spacing.md }}>
        {visibleTeams.length} of {teams.length} teams
      </Txt>

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
                style={styles.input}
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
    </View>
  );
}

function PendingSection({
  matches,
  players,
  onReload,
}: {
  matches: AdminPendingMatch[];
  players: Map<string, LeaguePlayer>;
  onReload: () => void;
}) {
  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>
        Pending & Disputed
      </Txt>

      {matches.length === 0 ? (
        <Txt color={colors.textDim}>No pending matches.</Txt>
      ) : (
        matches.map((m) => (
          <AdminMatchCard key={m.id} match={m} players={players} onReload={onReload} />
        ))
      )}
    </View>
  );
}

function AdminMatchCard({
  match: m,
  players,
  onReload,
}: {
  match: AdminPendingMatch;
  players: Map<string, LeaguePlayer>;
  onReload: () => void;
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
      onReload();
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
                style={[styles.input, styles.scoreInput]}
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
                style={[styles.input, styles.scoreInput]}
              />
            </View>
          </View>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
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
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.accent },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  input: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
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
