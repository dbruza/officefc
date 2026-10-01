/**
 * Account creation — step 1 of the first-run path (account → verify email → profile →
 * join). Same keyboard flow as sign-in: Enter moves email → password → submit.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { Link } from "expo-router";
import { FormScreen, Txt } from "@/components";
import { RefTextField, SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { readStashedJoinCode } from "@/lib/inviteLink";
import { useBreakpoint } from "@/lib/responsive";
import { colors } from "@/theme";

type Field = "email" | "password";

function fieldFor(code: string): Field | null {
  if (code === "auth/invalid-email" || code === "auth/email-already-in-use") return "email";
  if (code === "auth/weak-password" || code === "auth/missing-password") return "password";
  return null;
}

function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
}

const PASSWORD_HINT = "At least 6 characters. We'll email you a link to verify it's you.";

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Arrived through an invite link? Then the code is already saved for the join step.
  const [invited, setInvited] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const { isWeb, isTablet } = useBreakpoint();

  useEffect(() => {
    let cancelled = false;
    void readStashedJoinCode().then((code) => {
      if (!cancelled && code) setInvited(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (busy) return;
    setError(null);
    if (!email.trim()) return setError({ field: "email", message: "Enter your email." });
    if (password.length < 6) {
      return setError({ field: "password", message: "Password should be at least 6 characters." });
    }
    setBusy(true);
    try {
      await signUp(email, password);
      // Routing → verify-email once the (unverified) user is created.
    } catch (e) {
      setError({ field: fieldFor(codeOf(e)), message: authErrorMessage(e) });
      setBusy(false);
    }
  }

  const fieldError = (field: Field) => (error?.field === field ? error.message : undefined);
  const passwordError = fieldError("password");

  return (
    <FormScreen
      title={invited ? "You're invited" : "Join the league"}
      subtitle={
        invited
          ? "Create an account and verify your email. Your join code is saved, so you'll go straight into the league."
          : "Create an account, verify your email, set up your player profile, then join with your office's code."
      }
      documentTitle="Create account"
      step={1}
      onSubmit={submit}
      footer={
        <View style={styles.footerRow}>
          <Txt size={13} color={colors.textDim}>
            Already have an account?
          </Txt>
          <Link href="/(auth)/sign-in">
            <Txt variant="head" size={13} color={colors.accent}>
              Sign in
            </Txt>
          </Link>
        </View>
      }
    >
      <RefTextField
        label="Email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error?.field === "email") setError(null);
        }}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        inputMode="email"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        hint={fieldError("email")}
        error={!!fieldError("email")}
        autoFocus={isWeb && isTablet}
      />
      <RefTextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (error?.field === "password") setError(null);
        }}
        placeholder="Pick something memorable"
        secure
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        hint={passwordError ?? PASSWORD_HINT}
        error={!!passwordError}
        returnKeyType="go"
        onSubmitEditing={submitOnEnter(submit)}
      />
      {error && !error.field ? (
        <Txt size={13} color={colors.loss} accessibilityLiveRegion="polite">
          {error.message}
        </Txt>
      ) : null}
      <SubmitButton loading={busy} onPress={submit}>
        {busy ? "Creating account…" : "Create account"}
      </SubmitButton>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
});
