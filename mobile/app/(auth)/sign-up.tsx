import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { FormScreen, TextField, Button, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { colors } from "@/theme";

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password);
      // Routing → verify-email once the (unverified) user is created.
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title="Join the league"
      subtitle="Create an account, then enter your office's invite code."
      footer={
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
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
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 6 characters"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        hint="We'll email you a verification link."
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? (
        <Txt size={13} color={colors.loss}>
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" onPress={submit}>
        {busy ? "Creating account…" : "Create account"}
      </Button>
    </FormScreen>
  );
}
