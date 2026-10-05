/**
 * Account creation — step 1 of the first-run path (account → verify email → profile →
 * join). Same keyboard flow as sign-in: Enter moves email → password → submit. Agreeing
 * to the terms and privacy policy is required; both open in a sheet from the tick row, so
 * the form underneath keeps what was typed.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { Link } from "expo-router";
import { FormScreen, Icon, Interactive, Txt, useLegalSheet } from "@/components";
import { RefTextField, SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { readStashedJoinCode } from "@/lib/inviteLink";
import { useBreakpoint } from "@/lib/responsive";
import { colors, spacing } from "@/theme";

type Field = "email" | "password" | "terms";

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
  const legal = useLegalSheet();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
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
    if (!agreed) {
      return setError({
        field: "terms",
        message: "Tick the box to agree to the Terms of Use and Privacy Policy.",
      });
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
      <AgreeToTerms
        checked={agreed}
        error={fieldError("terms")}
        onOpen={legal.open}
        onToggle={() => {
          setAgreed((on) => !on);
          if (error?.field === "terms") setError(null);
        }}
      />
      {legal.sheet}
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

/**
 * Required agreement tick. The box is the checkbox; tapping the sentence ticks it too,
 * except on the two links, which open the documents in-app.
 */
function AgreeToTerms({
  checked,
  error,
  onToggle,
  onOpen,
}: {
  checked: boolean;
  error?: string;
  onToggle: () => void;
  onOpen: (href: "/terms" | "/privacy") => void;
}) {
  // On web a link's click would otherwise bubble up to the sentence and tick the box.
  const open = (href: "/terms" | "/privacy") => (event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
    onOpen(href);
  };
  return (
    <View>
      <View style={styles.agreeRow}>
        <Interactive
          accessibilityRole="checkbox"
          accessibilityLabel="I agree to the Terms of Use and Privacy Policy"
          accessibilityState={{ checked }}
          onPress={onToggle}
          hitSlop={12}
          pressScale={0.9}
          style={[styles.box, checked ? styles.boxChecked : error ? styles.boxError : null]}
          hoverStyle={checked ? undefined : styles.boxHover}
        >
          {checked ? <Icon name="check" size={14} stroke={3} color={colors.onAccent} /> : null}
        </Interactive>
        <Txt size={13} color={colors.textDim} style={styles.agreeText} onPress={onToggle}>
          I agree to the{" "}
          <Txt
            variant="head"
            size={13}
            color={colors.accent}
            accessibilityRole="link"
            onPress={open("/terms")}
          >
            Terms of Use
          </Txt>{" "}
          and{" "}
          <Txt
            variant="head"
            size={13}
            color={colors.accent}
            accessibilityRole="link"
            onPress={open("/privacy")}
          >
            Privacy Policy
          </Txt>
        </Txt>
      </View>
      {error ? (
        <Txt
          size={12}
          color={colors.loss}
          style={{ marginTop: spacing.sm }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  agreeText: { flex: 1, lineHeight: 20, marginTop: 1 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  boxHover: { borderColor: colors.textDim },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  boxError: { borderColor: colors.loss },
});
