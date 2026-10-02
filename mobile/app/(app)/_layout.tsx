import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { invalidateData } from "@/lib/dataCache";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { Txt } from "@/components/Txt";
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
  const [updating, setUpdating] = useState(false);
  const { isTablet } = useBreakpoint();
  const { matches: pending } = usePendingConfirmations(user?.uid);

  useEffect(() => {
    if (!user) return;
    let previous: number | undefined;
    return onSnapshot(
      doc(db, "readModelQueue", "office"),
      (snap) => {
        const revision = Number(snap.get("completedRevision") ?? 0);
        setUpdating(Number(snap.get("requestedRevision") ?? 0) > revision);
        if (previous !== undefined && previous !== revision) invalidateData();
        previous = revision;
      },
      () => {},
    );
  }, [user?.uid]);
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
          {updating ? (
            <Txt
              size={11}
              color={colors.textDim}
              style={{ paddingHorizontal: 16, paddingVertical: 6 }}
              accessibilityLiveRegion="polite"
            >
              Updating league standings…
            </Txt>
          ) : null}
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
          />
        </View>
      </View>
      {Platform.OS === "web" ? <CommandPalette /> : null}
    </PendingCountContext.Provider>
  );
}
