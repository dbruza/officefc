import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { FormScreen, TextField, Button, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { colors } from "@/theme";

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
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
      title="Reset password"
      subtitle="Enter your email and we'll send a reset link."
      footer={
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          <Link href="/(auth)/sign-in">
            <Txt variant="head" size={13} color={colors.accent}>
              Back to sign in
            </Txt>
          </Link>
        </View>
      }
    >
      {sent ? (
        <Txt size={14} color={colors.win} style={{ lineHeight: 20 }}>
          If an account exists for {email.trim()}, a reset link is on its way. Check your inbox.
        </Txt>
      ) : (
        <>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            onSubmitEditing={submit}
            returnKeyType="send"
          />
          {error ? (
            <Txt size={13} color={colors.loss}>
              {error}
            </Txt>
          ) : null}
          <Button full size="lg" onPress={submit}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </>
      )}
    </FormScreen>
  );
}
