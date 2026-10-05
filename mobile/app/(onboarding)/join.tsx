/**
 * Step 4 of first run: redeem the league's join code. An invite link (/join?code=…)
 * prefills it — and because a signed-out visitor gets bounced to sign-in first, the code
 * is stashed the moment this screen sees it and read back when they arrive here later.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, FormScreen, Icon, TextField, Txt } from "@/components";
import { SubmitButton, submitOnEnter } from "@/components/FormScreen";
import { useAuth } from "@/lib/auth";
import { getJoinOptions, redeemInvite } from "@/lib/membership";
import { authErrorMessage } from "@/lib/authErrors";
import { confirmAction } from "@/lib/dialogs";
import {
  clearStashedJoinCode,
  normalizeJoinCode,
  readStashedJoinCode,
  stashJoinCode,
} from "@/lib/inviteLink";
import { useBreakpoint } from "@/lib/responsive";
import { colors } from "@/theme";

export default function Join() {
  const { user, refresh, signOutUser } = useAuth();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const linkCode = normalizeJoinCode(
    (Array.isArray(params.code) ? params.code[0] : params.code) ?? "",
  );
  const [code, setCode] = useState(linkCode);
  // True when the code came from an invite link rather than being typed.
  const [fromLink, setFromLink] = useState(linkCode.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Once the user types, a late-arriving stashed code must not overwrite their input.
  const typed = useRef(false);
  // Admin setup is the server's call; until it answers, the screen asks for a code.
  const [admin, setAdmin] = useState(false);
  const { isWeb, isTablet } = useBreakpoint();

  useEffect(() => {
    let cancelled = false;
    getJoinOptions()
      .then((options) => {
        if (!cancelled) setAdmin(options.adminSetup);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (linkCode) {
      // Runs before the root navigator's redirect (child effects fire first), so a
      // signed-out visitor's code survives the trip through sign-up.
      void stashJoinCode(linkCode);
      return;
    }
    let cancelled = false;
    void readStashedJoinCode().then((stashed) => {
      if (cancelled || !stashed || typed.current) return;
      setCode(stashed);
      setFromLink(true);
    });
    return () => {
      cancelled = true;
    };
  }, [linkCode]);

  async function submit() {
    if (busy) return;
    setError(null);
    if (!admin && code.trim().length === 0) return setError("Enter your join code.");
    setBusy(true);
    try {
      await redeemInvite(code);
      await clearStashedJoinCode();
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
          ? "You're on the admin allowlist, so we'll set you up to run the league."
          : fromLink
            ? "Your invite code is filled in. Check it and you're in."
            : "Enter your league's join code. Ask an admin to share it (or their invite link)."
      }
      documentTitle="Join league"
      step={4}
      onSubmit={submit}
      footer={
        <View style={{ alignItems: "center" }}>
          <Button
            variant="ghost"
            size="sm"
            icon="logout"
            style={{ alignSelf: "center" }}
            onPress={() =>
              confirmAction({
                title: "Sign out?",
                message: "You can pick up joining again the next time you sign in.",
                confirmLabel: "Sign out",
                destructive: true,
                onConfirm: () => void signOutUser(),
              })
            }
          >
            Sign out
          </Button>
        </View>
      }
    >
      {admin ? (
        <Card style={styles.adminCard}>
          <View style={styles.adminHead}>
            <Icon name="shield" size={16} color={colors.accent} />
            <Txt variant="head" size={13} color={colors.accent}>
              Admin setup
            </Txt>
          </View>
          <Txt size={13} color={colors.textDim} style={{ marginTop: 4, lineHeight: 19 }}>
            Continue to create the league and join as an admin, no code needed. You can then share a
            season join code with everyone else.
          </Txt>
        </Card>
      ) : (
        <TextField
          label="Join code"
          value={code}
          onChangeText={(t) => {
            typed.current = true;
            setCode(normalizeJoinCode(t));
            setFromLink(false);
            setError(null);
          }}
          placeholder="e.g. OFC-7F3K9"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={submitOnEnter(submit)}
          hint={error ?? (fromLink ? "From your invite link." : undefined)}
          error={!!error}
          autoFocus={isWeb && isTablet && !linkCode}
        />
      )}
      {admin && error ? (
        <Txt size={13} color={colors.loss} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <SubmitButton loading={busy} onPress={submit}>
        {busy ? "Joining…" : admin ? "Create league & join" : "Join league"}
      </SubmitButton>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  adminCard: { borderColor: colors.accent, borderWidth: 1 },
  adminHead: { flexDirection: "row", alignItems: "center", gap: 6 },
});
