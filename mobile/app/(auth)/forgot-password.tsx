/** Password reset request. Success swaps the form for a confirmation with a way back. */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Button, FormScreen, Icon, TextField, Txt } from "@/components";
import { SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { useBreakpoint } from "@/lib/responsive";
import { withAlpha } from "@/lib/color";
import { colors, radius, spacing } from "@/theme";

export default function ForgotPassword() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { isWeb, isTablet } = useBreakpoint();

  async function submit() {
    if (busy) return;
    setError(null);
    if (!email.trim()) return setError("Enter the email you signed up with.");
    setBusy(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={sent ? "Check your inbox" : "Reset password"}
      subtitle={sent ? undefined : "Enter your email and we'll send a reset link."}
      documentTitle="Reset password"
      onSubmit={sent ? undefined : submit}
      footer={
        sent ? undefined : (
          <View style={styles.footerRow}>
            <Link href="/(auth)/sign-in">
              <Txt variant="head" size={13} color={colors.accent}>
                Back to sign in
              </Txt>
            </Link>
          </View>
        )
      }
    >
      {sent ? (
        <View style={styles.sent} accessibilityLiveRegion="polite">
          <View style={styles.sentIcon}>
            <Icon name="check" size={18} color={colors.win} stroke={2.6} />
          </View>
          <Txt size={14} color={colors.text} style={{ flex: 1, lineHeight: 20 }}>
            If an account exists for {email.trim()}, a reset link is on its way.
          </Txt>
        </View>
      ) : null}
      {sent ? (
        <Button full size="lg" variant="dark" onPress={() => router.replace("/(auth)/sign-in")}>
          Back to sign in
        </Button>
      ) : null}
      {sent ? (
        <Button
          variant="ghost"
          size="sm"
          style={{ alignSelf: "center" }}
          onPress={() => setSent(false)}
        >
          Use a different email
        </Button>
      ) : null}
      {sent ? null : (
        <TextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(null);
          }}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="send"
          onSubmitEditing={submitOnEnter(submit)}
          hint={error ?? undefined}
          error={!!error}
          autoFocus={isWeb && isTablet}
        />
      )}
      {sent ? null : (
        <SubmitButton loading={busy} onPress={submit}>
          {busy ? "Sending…" : "Send reset link"}
        </SubmitButton>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  sent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.win, 0.3),
    backgroundColor: withAlpha(colors.win, 0.06),
  },
  sentIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.win, 0.12),
  },
});
