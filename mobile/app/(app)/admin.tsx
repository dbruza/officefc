import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  resolveMatch,
  listSeasons,
  getTeams,
  getAdminPendingMatches,
  type Team,
  type AdminPendingMatch,
} from "@/lib/league";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

type Section = "seasons" | "teams" | "pending";

export default function AdminScreen() {
  const router = useRouter();
  const { profile, membership } = useAuth();
  const [section, setSection] = useState<Section>("seasons");
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; active: boolean; finalized: boolean }>>([]);
  const [teams, setTeamsList] = useState<Team[]>([]);
  const [pending, setPending] = useState<AdminPendingMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = membership?.role === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const [s, t, p] = await Promise.all([listSeasons(), getTeams(), getAdminPendingMatches()]);
      setSeasons(s);
      setTeamsList(t);
      setPending(p.map((m) => ({ ...m })));
    } catch (e) {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.center}>
          <Txt variant="head" size={18}>Admin only</Txt>
          <Txt color={colors.textDim} style={{ marginTop: spacing.sm }}>You need admin privileges.</Txt>
        </View>
      </SafeAreaView>
    );
  }

  async function handleCreateSeason() {
    const name = `Season ${new Date().getFullYear()}`;
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 90 * 86400000).toISOString();
    try {
      await createSeason(name, start, end);
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="x" size={20} stroke={2.5} />
        </Pressable>
        <Txt variant="head" size={18}>Admin</Txt>
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
          {section === "pending" ? <PendingSection matches={pending} onReload={load} /> : null}

          {error ? (
            <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>{error}</Txt>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SeasonsSection({ seasons, onReload }: { seasons: Array<{ id: string; name: string; active: boolean; finalized: boolean }>; onReload: () => void }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  async function doCreate() {
    if (!newName) return;
    try {
      await createSeason(newName, newStart || new Date().toISOString(), newEnd || new Date(Date.now() + 90 * 86400000).toISOString());
      setCreating(false);
      setNewName(""); setNewStart(""); setNewEnd("");
      onReload();
    } catch (e: any) { Alert.alert("Error", e.message); }
  }

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>Seasons</Txt>

      {creating ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Txt variant="head" size={13} style={{ marginBottom: spacing.md }}>New Season</Txt>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Name (e.g. Summer 2027)" placeholderTextColor={colors.textFaint} style={styles.input} />
          <TextInput value={newStart} onChangeText={setNewStart} placeholder="Start (ISO date)" placeholderTextColor={colors.textFaint} style={styles.input} />
          <TextInput value={newEnd} onChangeText={setNewEnd} placeholder="End (ISO date)" placeholderTextColor={colors.textFaint} style={styles.input} />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Button size="sm" onPress={doCreate}>Create</Button>
            <Button size="sm" variant="ghost" onPress={() => setCreating(false)}>Cancel</Button>
          </View>
        </Card>
      ) : (
        <Button size="md" icon="plus" onPress={() => setCreating(true)} style={{ marginBottom: spacing.lg }}>
          New Season
        </Button>
      )}

      {seasons.map((s) => (
        <Card key={s.id} style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Txt variant="bodyMedium" size={14}>{s.name}</Txt>
              <Txt size={11} color={colors.textDim} style={{ marginTop: 2 }}>
                {s.active ? "Active" : s.finalized ? "Finalized" : "Inactive"}
              </Txt>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {!s.active && !s.finalized ? (
                <Button size="sm" variant="dark" onPress={async () => { await activateSeason(s.id); onReload(); }}>
                  Activate
                </Button>
              ) : null}
              {s.active ? (
                <Button size="sm" variant="dark" onPress={async () => {
                  await finalizeSeason(s.id);
                  onReload();
                }}>
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

  async function doAdd() {
    if (!newTeamName) return;
    try { await manageTeam("add", newTeamName); setAdding(false); setNewTeamName(""); onReload(); } catch (e: any) { Alert.alert("Error", e.message); }
  }

  async function doRename(teamId: string) {
    if (!renameName) return;
    try { await manageTeam("rename", teamId, renameName); setRenaming(null); onReload(); } catch (e: any) { Alert.alert("Error", e.message); }
  }

  async function doDeactivate(teamId: string, name: string) {
    Alert.alert("Deactivate", `Deactivate ${name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Deactivate", style: "destructive", onPress: async () => { await manageTeam("deactivate", teamId); onReload(); } },
    ]);
  }

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>Teams</Txt>

      {adding ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <TextInput value={newTeamName} onChangeText={setNewTeamName} placeholder="Team name" placeholderTextColor={colors.textFaint} style={styles.input} />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Button size="sm" onPress={doAdd}>Add</Button>
            <Button size="sm" variant="ghost" onPress={() => setAdding(false)}>Cancel</Button>
          </View>
        </Card>
      ) : (
        <Button size="md" icon="plus" onPress={() => setAdding(true)} style={{ marginBottom: spacing.lg }}>
          Add Team
        </Button>
      )}

      <FlatList
        data={teams}
        scrollEnabled={false}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
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
                <Button size="sm" onPress={() => doRename(item.id)}>Save</Button>
                <Button size="sm" variant="ghost" onPress={() => setRenaming(null)}>Cancel</Button>
              </View>
            </Card>
          ) : (
            <Card key={item.id} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <Txt variant="bodyMedium" size={14}>{item.name}</Txt>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button size="sm" variant="ghost" onPress={() => { setRenaming(item.id); setRenameName(item.name); }}>
                    Rename
                  </Button>
                  <Button size="sm" variant="danger" onPress={() => doDeactivate(item.id, item.name)}>
                    Deactivate
                  </Button>
                </View>
              </View>
            </Card>
          )
        )}
      />
    </View>
  );
}

function PendingSection({ matches, onReload }: { matches: AdminPendingMatch[]; onReload: () => void }) {
  async function doResolve(matchId: string, action: "confirm" | "void") {
    try {
      await resolveMatch(matchId, action);
      onReload();
    } catch (e: any) { Alert.alert("Error", e.message); }
  }

  return (
    <View>
      <Txt variant="head" size={18} style={{ marginBottom: spacing.lg }}>Pending & Disputed</Txt>

      {matches.length === 0 ? (
        <Txt color={colors.textDim}>No pending matches.</Txt>
      ) : (
        matches.map((m) => (
          <Card key={m.id} style={{ marginBottom: spacing.sm }}>
            <Txt variant="monoBold" size={16} style={{ marginBottom: spacing.sm }}>
              {m.aGoals}:{m.bGoals}
            </Txt>
            <Txt size={12} color={colors.textDim}>
              {m.aTeam} vs {m.bTeam}
            </Txt>
            <Txt size={11} color={colors.textFaint} style={{ marginTop: 4 }}>
              ID: {m.id.slice(0, 8)}… · Submitted: {m.date?.toLocaleDateString() ?? "?"}
            </Txt>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Button size="sm" onPress={() => doResolve(m.id, "confirm")}>
                Confirm
              </Button>
              <Button size="sm" variant="danger" onPress={() => doResolve(m.id, "void")}>
                Void
              </Button>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", paddingHorizontal: spacing.lg, marginBottom: spacing.lg, gap: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.accent },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  input: { color: colors.text, fontSize: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.sm },
});
