/**
 * Root layout: loads fonts, provides auth state, and gates navigation between the
 * (auth) → (onboarding) → (app) route groups based on the user's onboarding stage.
 */
// MUST stay the first import: evaluating it runs Sentry.init, so crashes anywhere in the
// firebase/auth import graph below are captured. Reordering silently loses that coverage.
import { navigationIntegration } from "@/lib/sentry";
import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import { Slot, useNavigationContainerRef, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { View, ActivityIndicator, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts, colors } from "@/theme";
import { Button, Txt } from "@/components";
import { AuthProvider, useAuth } from "@/lib/auth";
import { resolveNotificationRoute } from "@/lib/notifications";
import { setLogRoute } from "@/lib/logger";
import { installGlobalErrorLogging } from "@/lib/logger/globalHandler";
import { LogErrorBoundary } from "@/components/LogErrorBoundary";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Full-screen retry card shown when bootstrap reads fail (offline / Firestore down). */
function BootstrapFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
      }}
    >
      <Txt variant="head" size={17}>
        Can't reach the league
      </Txt>
      <Txt size={12.5} color={colors.textDim} style={{ textAlign: "center", marginTop: 8 }}>
        Your sign-in is fine, but your profile couldn't be loaded. Check the connection and try
        again.
      </Txt>
      <Button variant="dark" onPress={onRetry} style={{ marginTop: 16 }}>
        Retry
      </Button>
    </View>
  );
}

/** Decides which group the user belongs in and redirects there. */
function RootNavigator() {
  const {
    initializing,
    loadingProfile,
    profileReadFailed,
    user,
    emailVerified,
    profile,
    membership,
    refresh,
  } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const ready = !initializing && !loadingProfile;

  useEffect(() => {
    setLogRoute(segments.join("/") || "/");
  }, [segments]);

  useEffect(() => {
    if (!ready) return;
    // A failed bootstrap read says nothing about onboarding stage — hold position and let
    // the user retry rather than bouncing an established user into profile-setup/join.
    if (profileReadFailed) return;
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
    if (group !== "(app)") router.replace("/(app)/(tabs)");
  }, [ready, profileReadFailed, user, emailVerified, profile, membership, segments, router]);

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
  if (user && profileReadFailed) {
    return <BootstrapFailed onRetry={() => void refresh()} />;
  }
  return (
    <LogErrorBoundary>
      <Slot />
    </LogErrorBoundary>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const router = useRouter();
  const navRef = useNavigationContainerRef();

  useEffect(() => {
    installGlobalErrorLogging();
  }, []);

  useEffect(() => {
    // Guard on .current: the SDK unwraps it at call time and silently gives up on null.
    if (navRef?.current) navigationIntegration.registerNavigationContainer(navRef);
  }, [navRef]);

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
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);

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
