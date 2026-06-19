import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Icon, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/theme";
import { SeasonsSection } from "@/screens/admin/SeasonsSection";
import { TeamsSection } from "@/screens/admin/TeamsSection";
import { PendingSection } from "@/screens/admin/PendingSection";

type Section = "seasons" | "teams" | "pending";

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
