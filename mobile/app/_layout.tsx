/**
 * Root layout: loads fonts, provides auth state, and gates navigation between the
 * (auth) → (onboarding) → (app) route groups based on the user's onboarding stage.
 */
import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { View, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts, colors } from "@/theme";
import { AuthProvider, useAuth } from "@/lib/auth";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Decides which group the user belongs in and redirects there. */
function RootNavigator() {
  const { initializing, loadingProfile, user, emailVerified, profile, membership } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const ready = !initializing && !loadingProfile;

  useEffect(() => {
    if (!ready) return;
    const group = segments[0]; // "(auth)" | "(onboarding)" | "(app)" | undefined
    const screen = segments[1];

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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
