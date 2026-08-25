import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Card, Icon, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/theme";
import { SeasonsSection } from "@/screens/admin/SeasonsSection";
import { TeamsSection } from "@/screens/admin/TeamsSection";
import { PendingSection } from "@/screens/admin/PendingSection";
import { getActiveSeason, getCup, startCup } from "@/lib/league";

type Section = "seasons" | "teams" | "pending";

/** One-card control for the mid-season knockout: live status + the draw action. Sits on
 *  the admin shell rather than inside SeasonsSection to keep this wave's diff small. */
function CupCard() {
  const router = useRouter();
  // The active season's id+name travel together so the alert closure needs no deps.
  const [active, setActive] = useState<{ id: string; name: string } | null>(null);
  const [hasCup, setHasCup] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const season = await getActiveSeason();
    const cup = season ? await getCup(season.id) : null;
    setActive(season ? { id: season.id, name: season.name } : null);
    setHasCup(cup !== null);
  }, []);

  useEffect(() => {
    load().catch(() => setActive(null));
  }, [load]);

  function confirmStart() {
    if (!active) return;
    Alert.alert(
      "Start mid-season cup",
      `Draw a random knockout bracket from every member for ${active.name}? Cup games count toward ELO and the table.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Draw",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            startCup(active.id)
              .then(() => router.push("/(app)/cup"))
              .catch((error: unknown) =>
                Alert.alert(
                  "Couldn't start the cup",
                  error instanceof Error ? error.message : "Try again.",
                ),
              )
              .finally(() => {
                setBusy(false);
                load().catch(() => undefined);
              });
          },
        },
      ],
    );
  }

  if (!active) return null;

  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <Txt variant="head" size={13}>
        Mid-season cup
      </Txt>
      <Txt size={12} color={colors.textDim} style={{ marginTop: spacing.xs }}>
        {hasCup
          ? "A cup is running for the active season — see the bracket screen."
          : "Knockout bracket for all members, played alongside the table."}
      </Txt>
      <Button
        size="sm"
        variant={hasCup ? "ghost" : "dark"}
        icon="trophy"
        disabled={busy}
        onPress={hasCup ? () => router.push("/(app)/cup") : confirmStart}
        style={{ marginTop: spacing.md }}
      >
        {busy ? "Drawing…" : hasCup ? "View cup" : "Start mid-season cup"}
      </Button>
    </Card>
  );
}

export default function AdminScreen() {
  const router = useRouter();
  const { membership } = useAuth();
  const [section, setSection] = useState<Section>("seasons");

  const isAdmin = membership?.role === "admin";

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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <CupCard />
        {section === "seasons" ? <SeasonsSection /> : null}
        {section === "teams" ? <TeamsSection /> : null}
        {section === "pending" ? <PendingSection /> : null}
      </ScrollView>
    </SafeAreaView>
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
});
