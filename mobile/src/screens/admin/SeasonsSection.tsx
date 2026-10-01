/**
 * Admin → Seasons: create a season and move seasons through their lifecycle. The list is
 * owned by the admin screen (the overview's phase card reads the same data) and every
 * lifecycle action goes through `useSeasonActions` for confirmation and busy guards.
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  DateTimeField,
  EmptyState,
  ErrorCard,
  Grid,
  Reveal,
  SkeletonRows,
  Tag,
  TextField,
  Txt,
} from "@/components";
import { Form, submitOnEnter } from "@/components/FormScreen";
import { createSeason } from "@/lib/league";
import { showAlert } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { callableErrorMessage } from "@/lib/authErrors";
import { durationLabel, withTime } from "@/lib/calendar";
import { colors, spacing } from "@/theme";
import { formatDay, type AdminSeason, type SeasonActions } from "./seasonActions";
import { SectionHead } from "./SectionHead";

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

function statusOf(s: AdminSeason): {
  label: string;
  tone: "accent" | "gold" | "neutral" | "loss";
} {
  if (s.finalized) return { label: "Finalized", tone: "neutral" };
  if (s.active)
    return s.phase === "finals"
      ? { label: "Finals", tone: "gold" }
      : { label: "Active", tone: "accent" };
  if (s.end && s.end.getTime() < Date.now())
    return { label: "Ended · not finalized", tone: "loss" };
  return { label: "Upcoming", tone: "neutral" };
}

export function SeasonsSection({
  seasons,
  loading,
  error,
  reload,
  actions,
  createRequested,
  onCreateHandled,
}: {
  seasons: AdminSeason[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<unknown>;
  actions: SeasonActions;
  /** Set by the parent to open the "new season" form (e.g. from the finalize guard). */
  createRequested: boolean;
  onCreateHandled: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState(defaultStart);
  const [newEnd, setNewEnd] = useState(() => defaultEnd(defaultStart()));
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  function startCreating() {
    const start = defaultStart();
    setNewName("");
    setNewStart(start);
    setNewEnd(defaultEnd(start));
    setAttempted(false);
    setCreating(true);
  }

  // Works whether the request arrives while this section is showing or mounts it.
  useEffect(() => {
    if (!createRequested) return;
    startCreating();
    onCreateHandled();
  }, [createRequested, onCreateHandled]);

  /** Keep the end after the start: dragging the start past it takes the end along. */
  function changeStart(start: Date) {
    setNewStart(start);
    if (newEnd <= start) setNewEnd(defaultEnd(start));
  }

  const datesValid = newEnd > newStart;
  const nameValid = newName.trim().length > 0;

  async function doCreate() {
    if (saving) return;
    setAttempted(true);
    if (!nameValid || !datesValid) return;
    setSaving(true);
    try {
      await createSeason(newName.trim(), newStart.toISOString(), newEnd.toISOString());
      toast.success(`${newName.trim()} created`);
      setCreating(false);
      void reload();
    } catch (e: unknown) {
      showAlert("Couldn't create the season", callableErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const anyBusy = actions.busy !== null;
  const busyFor = (id: string, action: string) =>
    actions.busy?.id === id && actions.busy.action === action;

  return (
    <View>
      <SectionHead
        title="Seasons"
        subtitle="Create the next season before finalizing the current one."
        action={
          creating ? null : (
            <Button size="sm" icon="plus" onPress={startCreating}>
              New season
            </Button>
          )
        }
      />

      {creating ? (
        <Reveal from="down" style={{ marginBottom: spacing.lg }}>
          <Card style={styles.createCard}>
            <Txt variant="head" size={15} style={{ marginBottom: spacing.md }}>
              New season
            </Txt>
            <View style={{ gap: spacing.md }}>
              <Form onSubmit={doCreate}>
                <TextField
                  label="Season name"
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="e.g. Winter 2027"
                  autoComplete="off"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={submitOnEnter(doCreate)}
                  hint={attempted && !nameValid ? "Give the season a name." : undefined}
                  error={attempted && !nameValid}
                />
                <View>
                  <DateTimeField label="Starts" value={newStart} onChange={changeStart} />
                  <DateTimeField
                    label="Ends"
                    value={newEnd}
                    onChange={setNewEnd}
                    minimumDate={newStart}
                    invalid={!datesValid}
                    helper={
                      datesValid ? durationLabel(newStart, newEnd) : "End must be after the start."
                    }
                  />
                </View>
                <View style={styles.row}>
                  <Button size="sm" loading={saving} onPress={doCreate}>
                    {saving ? "Creating…" : "Create season"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onPress={() => setCreating(false)}
                  >
                    Cancel
                  </Button>
                </View>
              </Form>
            </View>
          </Card>
        </Reveal>
      ) : null}

      {error && seasons.length === 0 ? (
        <ErrorCard message={error} onRetry={() => void reload()} retrying={loading} />
      ) : loading && seasons.length === 0 ? (
        <SkeletonRows count={3} height={72} />
      ) : seasons.length === 0 ? (
        <EmptyState
          icon="seasons"
          title="No seasons yet"
          body="Create the first season so players have somewhere to log matches."
          action={
            creating ? undefined : { label: "New season", icon: "plus", onPress: startCreating }
          }
        />
      ) : (
        <Grid min={340} maxColumns={2} gap={spacing.md}>
          {seasons.map((s, i) => (
            <Reveal key={s.id} index={i}>
              <SeasonRow season={s} actions={actions} disabled={anyBusy} busyFor={busyFor} />
            </Reveal>
          ))}
        </Grid>
      )}

      {error && seasons.length > 0 ? (
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

function SeasonRow({
  season: s,
  actions,
  disabled,
  busyFor,
}: {
  season: AdminSeason;
  actions: SeasonActions;
  disabled: boolean;
  busyFor: (id: string, action: string) => boolean;
}) {
  const router = useRouter();
  const status = statusOf(s);
  const ended = !!s.end && s.end.getTime() < Date.now();
  return (
    <Card style={[styles.seasonCard, s.active && styles.activeCard]}>
      <View style={styles.seasonTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="head" size={15} numberOfLines={1}>
            {s.name}
          </Txt>
          <Txt variant="mono" size={11.5} color={colors.textDim} style={{ marginTop: 3 }}>
            {formatDay(s.start)} → {formatDay(s.end)}
          </Txt>
        </View>
        <Tag tone={status.tone}>{status.label.toUpperCase()}</Tag>
      </View>
      <View style={[styles.row, { marginTop: spacing.md }]}>
        {!s.active && !s.finalized ? (
          <Button
            size="sm"
            variant="dark"
            icon="check"
            loading={busyFor(s.id, "activate")}
            disabled={disabled}
            onPress={() => actions.activate(s)}
          >
            Activate
          </Button>
        ) : null}
        {s.active && s.phase === "regular" ? (
          <Button
            size="sm"
            variant="dark"
            icon="trophy"
            loading={busyFor(s.id, "finals")}
            disabled={disabled}
            onPress={() => actions.startFinals(s)}
          >
            Start finals
          </Button>
        ) : null}
        {s.active && s.phase === "finals" ? (
          <Button
            size="sm"
            variant="ghost"
            icon="trophy"
            onPress={() => router.push("/(app)/finals")}
          >
            Bracket
          </Button>
        ) : null}
        {/* Active seasons, and ended ones left unfinalized after a plain "Activate". */}
        {!s.finalized && (s.active || ended) ? (
          <Button
            size="sm"
            variant="danger"
            loading={busyFor(s.id, "finalize")}
            disabled={disabled}
            onPress={() => actions.finalize(s)}
          >
            Finalize
          </Button>
        ) : null}
        {s.finalized ? (
          <Button
            size="sm"
            variant="ghost"
            icon="sparkle"
            onPress={() =>
              router.push({ pathname: "/(app)/recap/[seasonId]", params: { seasonId: s.id } })
            }
          >
            Recap
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  createCard: { borderColor: colors.lineStrong, maxWidth: 640 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  seasonCard: { minHeight: 112 },
  activeCard: { borderColor: colors.lineStrong },
  seasonTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
});
