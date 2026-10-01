import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { colors } from "@/theme";
import { useAuth } from "@/lib/auth";
import { requestAndRegisterToken, unregisterPushToken } from "@/lib/notifications";
import { SideNav } from "@/components/SideNav";
import { CommandPalette } from "@/components/CommandPalette";
import { useBreakpoint } from "@/lib/responsive";
import { usePendingConfirmations } from "@/lib/usePendingConfirmations";
import { setTitleBadge } from "@/lib/web";
import { PendingCountContext } from "@/lib/pendingCount";

export default function AppLayout() {
  const { user } = useAuth();
  const { isTablet } = useBreakpoint();
  const { matches: pending } = usePendingConfirmations(user?.uid);

  useEffect(() => {
    setTitleBadge(pending.length);
  }, [pending.length]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let token: string | null = null;

    requestAndRegisterToken(user.uid).then((t) => {
      if (cancelled) return;
      token = t;
    });

    return () => {
      cancelled = true;
      if (token && user) {
        unregisterPushToken(user.uid, token).catch(() => {});
      }
    };
  }, [user]);

  // Tablet and up: persistent side rail next to every screen (tabs and pushed screens
  // alike); the bottom tab bar hides itself at the same breakpoint. The Stack keeps the
  // same tree position either way so resizing across the breakpoint never remounts it.
  return (
    <PendingCountContext.Provider value={pending.length}>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
        {isTablet ? <SideNav pendingCount={pending.length} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
          />
        </View>
      </View>
      {Platform.OS === "web" ? <CommandPalette /> : null}
    </PendingCountContext.Provider>
  );
}
