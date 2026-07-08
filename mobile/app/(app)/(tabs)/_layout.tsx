/**
 * Bottom-tab navigator for the four main pages. Tab screens stay mounted between
 * switches (no stack replace animation) and the AppTabBar renders once as
 * persistent navigator chrome instead of inside each screen.
 */
import { Tabs } from "expo-router";
import { AppTabBar, type AppTab } from "@/components";
import { colors } from "@/theme";

const ROUTE_TO_TAB: Record<string, AppTab> = {
  index: "home",
  leaderboard: "leaderboard",
  seasons: "seasons",
  profile: "profile",
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        freezeOnBlur: true,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={({ state }) => (
        <AppTabBar active={ROUTE_TO_TAB[state.routes[state.index]?.name] ?? "home"} />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="leaderboard" />
      <Tabs.Screen name="seasons" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
