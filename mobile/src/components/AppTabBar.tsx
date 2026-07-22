import { Pressable, StyleSheet, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";
import { emitTabRetap } from "@/lib/tabRetap";

export type AppTab = "home" | "leaderboard" | "seasons" | "profile";

const TABS: { id: AppTab; label: string; icon: IconName; href: Href }[] = [
  { id: "home", label: "Home", icon: "home", href: "/(app)/(tabs)" },
  { id: "leaderboard", label: "Table", icon: "board", href: "/(app)/(tabs)/leaderboard" },
  { id: "seasons", label: "Seasons", icon: "seasons", href: "/(app)/(tabs)/seasons" },
  { id: "profile", label: "You", icon: "profile", href: "/(app)/(tabs)/profile" },
];

export function AppTabBar({ active }: { active: AppTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {TABS.slice(0, 2).map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={active === tab.id}
          onPress={() => (active === tab.id ? emitTabRetap(tab.id) : router.navigate(tab.href))}
        />
      ))}
      <View style={styles.fabSlot}>
        <Pressable onPress={() => router.push("/(app)/log-match")} style={styles.fab}>
          <Icon name="plus" size={25} stroke={2.7} color={colors.onAccent} />
        </Pressable>
      </View>
      {TABS.slice(2).map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={active === tab.id}
          onPress={() => (active === tab.id ? emitTabRetap(tab.id) : router.navigate(tab.href))}
        />
      ))}
    </View>
  );
}

function TabButton({
  tab,
  active,
  onPress,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Icon
        name={tab.icon}
        size={21}
        stroke={active ? 2.4 : 2}
        color={active ? colors.accent : colors.textDim}
      />
      <Txt variant="head" size={9.5} color={active ? colors.accent : colors.textDim}>
        {tab.label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 70,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: withAlpha(colors.bg, 0.98),
    flexDirection: "row",
    alignItems: "flex-start",
  },
  tab: {
    flex: 1,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  fabSlot: { flex: 1, alignItems: "center" },
  fab: {
    width: 54,
    height: 54,
    marginTop: -17,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
