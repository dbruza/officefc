import { useState } from "react";
import { View } from "react-native";
import { FormScreen, TextField, Button, Txt, Card } from "@/components";
import { useAuth } from "@/lib/auth";
import { redeemInvite } from "@/lib/membership";
import { isAllowlistedAdmin } from "@/lib/constants";
import { authErrorMessage } from "@/lib/authErrors";
import { colors, spacing } from "@/theme";

export default function Join() {
  const { user, refresh, signOutUser } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = isAllowlistedAdmin(user?.email);

  async function submit() {
    setError(null);
    if (!admin && code.trim().length === 0) return setError("Enter your invite code.");
    setBusy(true);
    try {
      await redeemInvite(code);
      await refresh(); // routing → app once membership exists
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title="Join your league"
      subtitle={
        admin
          ? "You're on the admin allowlist — we'll set you up to run the league."
          : "Enter the invite code an admin shared with you."
      }
      footer={
        <View style={{ alignItems: "center" }}>
          <Button variant="ghost" size="sm" onPress={signOutUser}>
            Sign out
          </Button>
        </View>
      }
    >
      {admin ? (
        <Card style={{ borderColor: colors.accent, borderWidth: 1 }}>
          <Txt variant="head" size={13} color={colors.accent}>
            Admin setup
          </Txt>
          <Txt size={13} color={colors.textDim} style={{ marginTop: 4, lineHeight: 19 }}>
            Tap below to create the league and join as an admin — no code needed. You can then
            generate invite codes for everyone else.
          </Txt>
        </Card>
      ) : (
        <TextField
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/\s/g, ""))}
          placeholder="e.g. OFC-7F3K9"
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
      )}
      {error ? (
        <Txt size={13} color={colors.loss} style={{ marginTop: spacing.xs }}>
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" onPress={submit}>
        {busy ? "Joining…" : admin ? "Create league & join" : "Join league"}
      </Button>
    </FormScreen>
  );
}
