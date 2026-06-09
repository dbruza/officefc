import { useEffect } from "react";
import { Stack } from "expo-router";
import { colors } from "@/theme";
import { useAuth } from "@/lib/auth";
import { requestAndRegisterToken, unregisterPushToken } from "@/lib/notifications";

export default function AppLayout() {
  const { user } = useAuth();

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

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
