/**
 * Email + password sign-in. Enter in the email field moves to the password; Enter there
 * submits (natively on web, through the FormScreen <form>, so password managers offer
 * to save). Field-specific errors sit under their field; the rest go above the button.
 */
import { useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { Link } from "expo-router";
import { FormScreen, Txt } from "@/components";
import { RefTextField, SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { useBreakpoint } from "@/lib/responsive";
import { colors } from "@/theme";

type Field = "email" | "password";

/** Which field an auth error code belongs under (null → general error). */
function fieldFor(code: string): Field | null {
  if (code === "auth/invalid-email" || code === "auth/user-not-found") return "email";
  if (code === "auth/missing-password" || code === "auth/wrong-password") return "password";
  return null;
}

function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
}

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  // Desktop/tablet browsers: start typing straight away. Phones would throw the keyboard
  // over the screen before anyone has read it.
  const { isWeb, isTablet } = useBreakpoint();

  async function submit() {
    if (busy) return;
    setError(null);
    if (!email.trim()) return setError({ field: "email", message: "Enter your email." });
    if (!password) return setError({ field: "password", message: "Enter your password." });
    setBusy(true);
    try {
      await signIn(email, password);
      // Routing is handled by the root navigator once auth state updates.
    } catch (e) {
      setError({ field: fieldFor(codeOf(e)), message: authErrorMessage(e) });
      setBusy(false);
    }
  }

  const fieldError = (field: Field) => (error?.field === field ? error.message : undefined);

  return (
    <FormScreen
      title="Welcome back"
      subtitle="Sign in to log matches and defend your rating."
      documentTitle="Sign in"
      onSubmit={submit}
      footer={
        <View style={styles.footerRow}>
          <Txt size={13} color={colors.textDim}>
            New here?
          </Txt>
          <Link href="/(auth)/sign-up">
            <Txt variant="head" size={13} color={colors.accent}>
              Create an account
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
        autoComplete="username"
        textContentType="username"
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
        placeholder="••••••••"
        secure
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submitOnEnter(submit)}
        hint={fieldError("password")}
        error={!!fieldError("password")}
      />
      <Link href="/(auth)/forgot-password" style={{ alignSelf: "flex-end" }}>
        <Txt variant="head" size={12.5} color={colors.accent}>
          Forgot password?
        </Txt>
      </Link>
      {error && !error.field ? (
        <Txt size={13} color={colors.loss} accessibilityLiveRegion="polite">
          {error.message}
        </Txt>
      ) : null}
      <SubmitButton loading={busy} onPress={submit}>
        {busy ? "Signing in…" : "Sign in"}
      </SubmitButton>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
});
