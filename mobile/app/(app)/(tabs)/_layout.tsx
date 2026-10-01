/**
 * Bottom-tab navigator for the four main pages. Tab screens stay mounted between
 * switches (no stack replace animation) and the AppTabBar renders once as
 * persistent navigator chrome instead of inside each screen. From the tablet
 * breakpoint up the (app) layout's SideNav takes over and the tab bar hides.
 */
import { Tabs } from "expo-router";
import { AppTabBar, type AppTab } from "@/components";
import { usePendingCount } from "@/lib/pendingCount";
import { useBreakpoint } from "@/lib/responsive";
import { colors } from "@/theme";

const ROUTE_TO_TAB: Record<string, AppTab> = {
  index: "home",
  leaderboard: "leaderboard",
  seasons: "seasons",
  profile: "profile",
};

export default function TabsLayout() {
  const { isTablet } = useBreakpoint();
  const pendingCount = usePendingCount();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        freezeOnBlur: true,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={({ state }) =>
        isTablet ? null : (
          <AppTabBar
            active={ROUTE_TO_TAB[state.routes[state.index]?.name] ?? "home"}
            pendingCount={pendingCount}
          />
        )
      }
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="leaderboard" />
      <Tabs.Screen name="seasons" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
