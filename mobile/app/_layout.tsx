/**
 * Root layout: loads fonts, provides auth state, and gates navigation between the
 * (auth) → (onboarding) → (app) route groups based on the user's onboarding stage.
 */
import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { View, ActivityIndicator, Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts, colors } from "@/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { resolveNotificationRoute } from "@/lib/notifications";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Decides which group the user belongs in and redirects there. */
function RootNavigator() {
  const { initializing, loadingProfile, user, emailVerified, profile, membership } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const ready = !initializing && !loadingProfile;

  useEffect(() => {
    if (!ready) return;
    const segmentList: string[] = segments;
    const group = segmentList[0];
    const screen = segmentList[1];

    if (!user) {
      if (group !== "(auth)") router.replace("/(auth)/sign-in");
      return;
    }
    if (!emailVerified) {
      if (screen !== "verify-email") router.replace("/(onboarding)/verify-email");
      return;
    }
    if (!profile) {
      if (screen !== "profile-setup") router.replace("/(onboarding)/profile-setup");
      return;
    }
    if (!membership) {
      if (screen !== "join") router.replace("/(onboarding)/join");
      return;
    }
    if (group !== "(app)") router.replace("/(app)");
  }, [ready, user, emailVerified, profile, membership, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, string>;
      const route = resolveNotificationRoute(data);
      if (route) {
        router.push(route);
      }
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = (response.notification.request.content.data ?? {}) as Record<string, string>;
        const route = resolveNotificationRoute(data);
        if (route) {
          router.push(route);
        }
      }
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.viewport}>
        <View style={styles.appShell}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  appShell: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.bg,
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    borderColor: colors.line,
  },
});
