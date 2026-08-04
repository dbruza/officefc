import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { Button, Card, DateTimeField, Txt } from "@/components";
import {
  createSeason,
  activateSeason,
  finalizeSeason,
  listSeasons,
  startFinals,
} from "@/lib/league";
import { colors, spacing } from "@/theme";
import { showAlert } from "@/lib/dialogs";
import { durationLabel, withTime } from "@/lib/calendar";
import { errorMessage, formStyles } from "./common";

/** Seasons run a quarter by default — the admin nudges the dates from there. */
const DEFAULT_LENGTH_DAYS = 90;

/** A season opens at 09:00 on its start day and closes at 21:00 on its last one. */
function defaultStart(): Date {
  return withTime(new Date(), 9, 0);
}

function defaultEnd(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + DEFAULT_LENGTH_DAYS);
  return withTime(end, 21, 0);
}

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
  const [newStart, setNewStart] = useState(defaultStart);
  const [newEnd, setNewEnd] = useState(() => defaultEnd(defaultStart()));
  const [saving, setSaving] = useState(false);

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

  function startCreating() {
    const start = defaultStart();
    setNewName("");
    setNewStart(start);
    setNewEnd(defaultEnd(start));
    setCreating(true);
  }

  /** Keep the end after the start: dragging the start past it takes the end along. */
  function changeStart(start: Date) {
    setNewStart(start);
    if (newEnd <= start) setNewEnd(defaultEnd(start));
  }

  async function doCreate() {
    if (!canCreate) return;
    setSaving(true);
    try {
      await createSeason(newName.trim(), newStart.toISOString(), newEnd.toISOString());
      setCreating(false);
      load();
    } catch (error: unknown) {
      showAlert("Error", errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const datesValid = newEnd > newStart;
  const canCreate = newName.trim().length > 0 && datesValid && !saving;

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
          <View style={{ marginTop: spacing.sm }}>
            <DateTimeField label="Starts" value={newStart} onChange={changeStart} />
            <DateTimeField
              label="Ends"
              value={newEnd}
              onChange={setNewEnd}
              minimumDate={newStart}
              invalid={!datesValid}
              helper={datesValid ? durationLabel(newStart, newEnd) : "End must be after the start."}
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Button size="sm" onPress={doCreate} disabled={!canCreate}>
              {saving ? "Creating…" : "Create"}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setCreating(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Button size="md" icon="plus" onPress={startCreating} style={{ marginBottom: spacing.lg }}>
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
