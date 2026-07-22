/** Shared identity form: used by onboarding profile setup and in-app profile editing. */
import { useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { TextField, Button, Txt, Avatar } from "@/components";
import { useAuth } from "@/lib/auth";
import { saveProfile, type ProfileInput } from "@/lib/profiles";
import { authErrorMessage } from "@/lib/authErrors";
import { initialsOf, type Player } from "@/types";
import { colors, spacing } from "@/theme";

const SWATCHES = [
  "#00ff87",
  "#ff5470",
  "#5b9dff",
  "#ffb020",
  "#c06bff",
  "#36e0c8",
  "#ff8a3d",
  "#9aa7ff",
];

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

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
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setError(null);
    const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
    const n = Number(jersey);
    if (displayName.trim().length < 2) return setError("Enter your display name.");
    if (!HANDLE_RE.test(cleanHandle))
      return setError("Handle: 2–20 chars, letters/numbers/underscore.");
    if (!Number.isInteger(n) || n < 1 || n > 99) return setError("Jersey number must be 1–99.");
    if (!user) return setError("Session expired — sign in again.");

    setBusy(true);
    try {
      await saveProfile(user.uid, { displayName, handle: cleanHandle, jersey: n, color });
      await onSaved();
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
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

      <TextField
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Marcus Bell"
        autoCapitalize="words"
      />
      <TextField
        label="Handle"
        value={handle}
        onChangeText={setHandle}
        placeholder="marcus"
        prefix="@"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Jersey number"
        value={jersey}
        onChangeText={(t) => setJersey(t.replace(/[^0-9]/g, "").slice(0, 2))}
        placeholder="10"
        keyboardType="number-pad"
        inputMode="numeric"
      />

      <View>
        <Txt
          variant="head"
          size={11}
          color={colors.textDim}
          style={{ letterSpacing: 1.2, marginBottom: 10 }}
        >
          AVATAR COLOUR
        </Txt>
        <View style={styles.swatches}>
          {SWATCHES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.swatch,
                { backgroundColor: c, borderColor: color === c ? colors.text : "transparent" },
              ]}
            />
          ))}
        </View>
      </View>

      {error ? (
        <Txt size={13} color={colors.loss}>
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" onPress={submit}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
});
