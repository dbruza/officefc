import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Button, Card, Icon, ScreenHeader, SectionLabel, Txt, type IconName } from "@/components";
import { useAuth } from "@/lib/auth";
import { confirmAction, showAlert } from "@/lib/dialogs";
import { colors, radius, spacing } from "@/theme";
import {
  PUSH_CATEGORIES,
  loadPushPrefs,
  toggleCategory,
  type PushCategoryKey,
} from "@/lib/league/pushPrefs";

export default function Settings() {
  const router = useRouter();
  const { user, membership, signOutUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const version = Constants.expoConfig?.version ?? "dev";
  // Muted categories as stored server-side; empty set = everything delivers.
  const [muted, setMuted] = useState<ReadonlySet<PushCategoryKey>>(new Set());
  const [busy, setBusy] = useState(false);
  // Ref twin of `busy` so the guard is synchronous: a row tap can fire both the
  // Pressable's onPress and the Switch's onValueChange in one render pass, and a
  // state-only guard wouldn't see the first call yet.
  const busyRef = useRef(false);
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadPushPrefs(uid)
      .then((list) => {
        if (!cancelled) setMuted(new Set(list));
      })
      .catch(() => {
        // Leave the default of nothing muted — the backend delivers by default too,
        // so the UI stays honest about what will actually happen.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  /** Optimistic flip with revert-on-failure; busy flag serializes rapid toggles. */
  async function handleToggle(category: PushCategoryKey, mute: boolean) {
    if (!uid || busyRef.current) return;
    const previous = muted;
    busyRef.current = true;
    setBusy(true);
    setMuted((current) => {
      const next = new Set(current);
      if (mute) next.add(category);
      else next.delete(category);
      return next;
    });
    try {
      setMuted(new Set(await toggleCategory(uid, category, mute)));
    } catch {
      setMuted(previous);
      showAlert("Couldn't update notifications", "Check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionLabel>Account</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row icon="profile" label="Signed in as" value={user?.email ?? "—"} />
          <Row
            icon="edit"
            label="Edit profile"
            chevron
            onPress={() => router.push("/(app)/edit-profile")}
          />
        </Card>

        {uid ? (
          <>
            <SectionLabel style={{ marginTop: spacing.x2 }}>Notifications</SectionLabel>
            <Card style={styles.group} padded={false}>
              {PUSH_CATEGORIES.map((category) => (
                <Pressable
                  key={category.key}
                  onPress={() => void handleToggle(category.key, !muted.has(category.key))}
                  style={styles.row}
                >
                  <View style={styles.rowIcon}>
                    <Icon name={category.icon} size={16} color={colors.textDim} />
                  </View>
                  <Txt variant="bodyMedium" size={13.5} style={{ flex: 1 }} numberOfLines={1}>
                    {category.label}
                  </Txt>
                  <Switch
                    value={!muted.has(category.key)}
                    disabled={busy}
                    onValueChange={(on) => void handleToggle(category.key, !on)}
                    trackColor={{ false: colors.surface2, true: colors.accent }}
                    thumbColor={muted.has(category.key) ? colors.textFaint : colors.onAccent}
                    ios_backgroundColor={colors.surface2}
                  />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        <SectionLabel style={{ marginTop: spacing.x2 }}>League</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row icon="jersey" label="Role" value={(membership?.role ?? "member").toUpperCase()} />
          {isAdmin ? (
            <Row
              icon="shield"
              label="Admin tools"
              chevron
              onPress={() => router.push("/(app)/admin")}
            />
          ) : null}
        </Card>

        <SectionLabel style={{ marginTop: spacing.x2 }}>About</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row
            icon="info"
            label="Version"
            value={`OfficeFC ${version}`}
            chevron
            onPress={() => router.push("/(app)/changelog")}
          />
        </Card>

        <Button
          full
          variant="ghost"
          style={{ marginTop: spacing.x3 }}
          onPress={() =>
            confirmAction({
              title: "Sign out?",
              message: "You can sign back in any time — your record stays on the table.",
              confirmLabel: "Sign out",
              destructive: true,
              onConfirm: () => void signOutUser(),
            })
          }
        >
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  chevron,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={16} color={colors.textDim} />
      </View>
      <Txt variant="bodyMedium" size={13.5} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="mono" size={12} color={colors.textDim} numberOfLines={1}>
          {value}
        </Txt>
      ) : null}
      {chevron ? <Icon name="chevron" size={15} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  group: { overflow: "hidden" },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
});
