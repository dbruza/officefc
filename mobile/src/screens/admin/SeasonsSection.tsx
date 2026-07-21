import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { Button, Card, Txt } from "@/components";
import {
  createSeason,
  activateSeason,
  finalizeSeason,
  listSeasons,
  startFinals,
} from "@/lib/league";
import { colors, spacing } from "@/theme";
import { showAlert } from "@/lib/dialogs";
import { errorMessage, formStyles } from "./common";

type Season = {
  id: string;
  name: string;
  active: boolean;
  finalized: boolean;
  phase?: string;
};

export function SeasonsSection() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const s = await listSeasons();
      setSeasons(s);
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
      load();
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
            style={formStyles.input}
          />
          <TextInput
            value={newStart}
            onChangeText={setNewStart}
            placeholder="Start (ISO date)"
            placeholderTextColor={colors.textFaint}
            style={formStyles.input}
          />
          <TextInput
            value={newEnd}
            onChangeText={setNewEnd}
            placeholder="End (ISO date)"
            placeholderTextColor={colors.textFaint}
            style={formStyles.input}
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

      {loading ? <ActivityIndicator color={colors.accent} /> : null}

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
                {s.active
                  ? s.phase === "finals"
                    ? "Active · Finals"
                    : "Active"
                  : s.finalized
                    ? "Finalized"
                    : "Inactive"}
              </Txt>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {!s.active && !s.finalized ? (
                <Button
                  size="sm"
                  variant="dark"
                  onPress={async () => {
                    try {
                      await activateSeason(s.id);
                    } catch (error: unknown) {
                      showAlert("Error", errorMessage(error));
                    }
                    load();
                  }}
                >
                  Activate
                </Button>
              ) : null}
              {s.active && s.phase !== "finals" ? (
                <Button
                  size="sm"
                  variant="dark"
                  onPress={async () => {
                    try {
                      // Locks the top-6 seeds and the Premier; the bracket takes over.
                      await startFinals(s.id);
                    } catch (error: unknown) {
                      showAlert("Error", errorMessage(error));
                    }
                    load();
                  }}
                >
                  Start finals
                </Button>
              ) : null}
              {s.active ? (
                <Button
                  size="sm"
                  variant="dark"
                  onPress={async () => {
                    try {
                      await finalizeSeason(s.id);
                    } catch (error: unknown) {
                      showAlert("Error", errorMessage(error));
                    }
                    load();
                  }}
                >
                  Finalize
                </Button>
              ) : null}
            </View>
          </View>
        </Card>
      ))}

      {error ? (
        <Txt color={colors.loss} size={13} style={{ marginTop: spacing.lg }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}
