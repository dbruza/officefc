/**
 * Shared identity form: used by onboarding profile setup and in-app profile editing.
 * Validation shows under each field once the user has tried to submit (not while they
 * are still typing their first attempt), and Enter walks name → handle → jersey → save.
 */
import { useMemo, useRef, useState } from "react";
import { View, StyleSheet, type TextInput } from "react-native";
import { Avatar, Icon, Interactive, Txt } from "@/components";
import { Form, RefTextField, SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { saveProfile, type ProfileInput } from "@/lib/profiles";
import { authErrorMessage } from "@/lib/authErrors";
import { initialsOf, type Player } from "@/types";
import { colors, spacing } from "@/theme";
import {
  DISPLAY_NAME_MAX,
  displayNameProblem,
  isOffensiveName,
} from "../../../functions/src/models/safety";

/** Avatar colours, named for screen readers and the hover tooltip. */
const SWATCHES = [
  { color: "#00ff87", name: "Pitch green" },
  { color: "#ff5470", name: "Red" },
  { color: "#5b9dff", name: "Blue" },
  { color: "#ffb020", name: "Amber" },
  { color: "#c06bff", name: "Purple" },
  { color: "#36e0c8", name: "Teal" },
  { color: "#ff8a3d", name: "Orange" },
  { color: "#9aa7ff", name: "Lavender" },
] as const;

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

type FieldErrors = Partial<Record<"displayName" | "handle" | "jersey", string>>;

function cleanHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function validate(displayName: string, handle: string, jersey: string): FieldErrors {
  const errors: FieldErrors = {};
  const n = Number(jersey);
  // Same rules the server screens with (models/safety.ts), so a name is never taken down
  // after it saved cleanly here.
  const nameProblem = displayNameProblem(displayName);
  if (nameProblem) errors.displayName = nameProblem;
  if (!HANDLE_RE.test(cleanHandle(handle)))
    errors.handle = "2–20 characters: letters, numbers or underscores.";
  else if (isOffensiveName(cleanHandle(handle)))
    errors.handle = "Pick a handle without offensive language.";
  if (!jersey || !Number.isInteger(n) || n < 1 || n > 99) errors.jersey = "Pick a number 1–99.";
  return errors;
}

export function ProfileForm({
  initial,
  submitLabel,
  onSaved,
}: {
  /** Prefill for editing; omit for first-time setup. */
  initial?: ProfileInput | null;
  submitLabel: string;
  onSaved: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [handle, setHandle] = useState(initial?.handle ?? "");
  const [jersey, setJersey] = useState(initial ? String(initial.jersey) : "");
  const [color, setColor] = useState<string>(initial?.color ?? SWATCHES[0].color);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Field errors stay hidden until the first submit attempt, then track edits live.
  const [attempted, setAttempted] = useState(false);
  const handleRef = useRef<TextInput>(null);
  const jerseyRef = useRef<TextInput>(null);

  const fieldErrors = attempted ? validate(displayName, handle, jersey) : {};

  const preview: Player = useMemo(
    () => ({
      id: user?.uid ?? "me",
      name: displayName.trim() || "Your Name",
      handle: handle.trim().replace(/^@/, "") || "handle",
      jersey: Number(jersey) || 0,
      color,
      initials: displayName.trim() ? initialsOf(displayName) : "?",
    }),
    [displayName, handle, jersey, color, user?.uid],
  );

  async function submit() {
    if (busy) return;
    setError(null);
    setAttempted(true);
    const errors = validate(displayName, handle, jersey);
    if (Object.keys(errors).length > 0) return;
    if (!user) return setError("Session expired. Sign in again.");

    setBusy(true);
    try {
      await saveProfile(user.uid, {
        displayName,
        handle: cleanHandle(handle),
        jersey: Number(jersey),
        color,
      });
      await onSaved();
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Form onSubmit={submit}>
        <View style={styles.previewRow}>
          <Avatar player={preview} size={64} jersey ring />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={18} numberOfLines={1}>
              {preview.name}
            </Txt>
            <Txt variant="mono" size={13} color={colors.textDim}>
              @{preview.handle} · #{preview.jersey || "—"}
            </Txt>
          </View>
        </View>

        <RefTextField
          label="Display name"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          onChangeText={setDisplayName}
          placeholder="Marcus Bell"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => handleRef.current?.focus()}
          hint={fieldErrors.displayName ?? "How you'll appear on the table."}
          error={!!fieldErrors.displayName}
        />
        <RefTextField
          ref={handleRef}
          label="Handle"
          value={handle}
          onChangeText={setHandle}
          placeholder="marcus"
          prefix="@"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => jerseyRef.current?.focus()}
          hint={fieldErrors.handle}
          error={!!fieldErrors.handle}
        />
        <RefTextField
          ref={jerseyRef}
          label="Jersey number"
          value={jersey}
          onChangeText={(t) => setJersey(t.replace(/[^0-9]/g, "").slice(0, 2))}
          placeholder="10"
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="off"
          returnKeyType="done"
          onSubmitEditing={submitOnEnter(submit)}
          hint={fieldErrors.jersey}
          error={!!fieldErrors.jersey}
        />

        <View>
          <Txt
            variant="head"
            size={11}
            color={colors.textDim}
            style={{ letterSpacing: 1.2, marginBottom: 10 }}
            nativeID="avatar-colour-label"
          >
            AVATAR COLOUR
          </Txt>
          <View
            style={styles.swatches}
            accessibilityRole="radiogroup"
            accessibilityLabelledBy="avatar-colour-label"
          >
            {SWATCHES.map((swatch) => {
              const selected = color === swatch.color;
              return (
                <Interactive
                  key={swatch.color}
                  onPress={() => setColor(swatch.color)}
                  accessibilityRole="radio"
                  accessibilityLabel={swatch.name}
                  accessibilityState={{ checked: selected }}
                  pressScale={0.9}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: swatch.color,
                      borderColor: selected ? colors.text : "transparent",
                    },
                  ]}
                  hoverStyle={[
                    { transform: [{ scale: 1.08 }] },
                    !selected && { borderColor: colors.lineStrong },
                  ]}
                >
                  {selected ? (
                    <Icon name="check" size={16} color={colors.onAccent} stroke={3} />
                  ) : null}
                </Interactive>
              );
            })}
          </View>
        </View>

        {error ? (
          <Txt size={13} color={colors.loss} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        <SubmitButton loading={busy} onPress={submit}>
          {busy ? "Saving…" : submitLabel}
        </SubmitButton>
      </Form>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  // 8 × 36 + 7 × 8 = 344: one row on a 375pt phone.
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
