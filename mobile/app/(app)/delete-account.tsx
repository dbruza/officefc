/**
 * Delete account: spells out what goes and what stays, then asks for the password (the
 * server only accepts a fresh sign-in) and a final confirmation.
 */
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, Card, Icon, Page, Reveal, ScreenHeader, TextField, Txt } from "@/components";
import { submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { deleteAccount } from "@/lib/account";
import { authErrorMessage, callableErrorMessage } from "@/lib/authErrors";
import { confirmAction } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { withAlpha } from "@/lib/color";
import { colors, spacing } from "@/theme";

const DELETED = [
  "Your login and email address",
  "Your name, handle, jersey and colour",
  "Every match photo you uploaded",
  "Notification tokens, settings, blocks and reports you sent",
];
const KEPT = [
  "Match results stay so other players' records and ratings don't change. Your name on them becomes “Deleted player”.",
  "Unconfirmed or disputed matches you're in are cancelled.",
];

export default function DeleteAccount() {
  const { user, signOutUser } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit() {
    if (busy) return;
    if (!password) return setError("Enter your password to confirm it's you.");
    setError(null);
    confirmAction({
      title: "Delete your account?",
      message: "This can't be undone. You'd need a new account and join code to play again.",
      confirmLabel: "Delete account",
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await deleteAccount(password);
          // The login is already gone server-side; this clears the local session and
          // sends the app back to sign-in.
          await signOutUser();
          toast.success("Your account has been deleted.");
        } catch (e: unknown) {
          const code = String((e as { code?: unknown })?.code ?? "");
          setError(code.startsWith("auth/") ? authErrorMessage(e) : callableErrorMessage(e));
          setBusy(false);
        }
      },
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Page
        width="narrow"
        header={<ScreenHeader title="Delete account" subtitle={user?.email ?? undefined} back />}
      >
        <Reveal>
          <Card style={styles.card}>
            <List title="Deleted" icon="x" tone={colors.loss} items={DELETED} />
            <List title="Kept, without your details" icon="info" items={KEPT} />
          </Card>
        </Reveal>
        <Reveal index={1} style={{ marginTop: spacing.x2 }}>
          <TextField
            label="Password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setError(null);
            }}
            placeholder="••••••••"
            secure
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submitOnEnter(submit)}
            hint={error ?? undefined}
            error={!!error}
          />
          <Button variant="danger" full loading={busy} onPress={submit} style={styles.button}>
            Delete my account
          </Button>
        </Reveal>
      </Page>
    </KeyboardAvoidingView>
  );
}

function List({
  title,
  icon,
  tone = colors.textDim,
  items,
}: {
  title: string;
  icon: "x" | "info";
  tone?: string;
  items: string[];
}) {
  return (
    <View style={styles.list}>
      <Txt variant="head" size={11} color={tone} style={{ letterSpacing: 1.2 }}>
        {title.toUpperCase()}
      </Txt>
      {items.map((item) => (
        <View key={item} style={styles.item}>
          <View style={[styles.bullet, { backgroundColor: withAlpha(tone, 0.12) }]}>
            <Icon name={icon} size={11} color={tone} />
          </View>
          <Txt size={13.5} style={{ flex: 1, lineHeight: 19 }}>
            {item}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.x2 },
  list: { gap: spacing.sm },
  item: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  button: { marginTop: spacing.md },
});
