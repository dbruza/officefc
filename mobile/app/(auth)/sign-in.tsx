import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { FormScreen, TextField, Button, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { colors } from "@/theme";

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // Routing is handled by the root navigator once auth state updates.
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title="Welcome back"
      subtitle="Sign in to log matches and defend your rating."
      footer={
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
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
        placeholder="••••••••"
        secure
        autoCapitalize="none"
        autoComplete="current-password"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      <Link href="/(auth)/forgot-password" style={{ alignSelf: "flex-end" }}>
        <Txt variant="head" size={12.5} color={colors.accent}>
          Forgot password?
        </Txt>
      </Link>
      {error ? (
        <Txt size={13} color={colors.loss}>
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" onPress={submit}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </FormScreen>
  );
}
