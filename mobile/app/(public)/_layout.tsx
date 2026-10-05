/**
 * Privacy policy, terms and support: open to everyone, signed in or out, at any stage of
 * onboarding. The root navigator never redirects away from this group.
 */
import { Stack } from "expo-router";
import { colors } from "@/theme";

export default function PublicLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
