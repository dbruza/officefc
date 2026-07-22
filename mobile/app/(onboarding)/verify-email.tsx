import { useState } from "react";
import { View } from "react-native";
import { FormScreen, Button, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { colors } from "@/theme";

export default function VerifyEmail() {
  const { user, resendVerification, reloadUser, signOutUser } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await reloadUser();
      // If now verified, the root navigator advances automatically. If not, hint the user.
      setNote("Not verified yet — click the link in your email, then tap again.");
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNote(null);
    try {
      await resendVerification();
      setNote("Verification email sent.");
    } catch (e) {
      setError(authErrorMessage(e));
    }
  }

  return (
    <FormScreen
      title="Verify your email"
      subtitle={`We sent a verification link to ${user?.email ?? "your email"}. Open it, then come back.`}
      footer={
        <View style={{ alignItems: "center" }}>
          <Button variant="ghost" size="sm" onPress={signOutUser}>
            Use a different account
          </Button>
        </View>
      }
    >
      {note ? (
        <Txt size={13} color={colors.win}>
          {note}
        </Txt>
      ) : null}
      {error ? (
        <Txt size={13} color={colors.loss}>
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" onPress={check}>
        {busy ? "Checking…" : "I've verified — continue"}
      </Button>
      <Button full variant="dark" onPress={resend}>
        Resend verification email
      </Button>
      {__DEV__ ? (
        <Txt size={11.5} color={colors.textFaint} style={{ lineHeight: 17 }}>
          Dev tip: when running against the Auth emulator, no real email is sent — open the
          verification link from the Emulator UI (Auth tab) or the emulator console output.
        </Txt>
      ) : null}
    </FormScreen>
  );
}
