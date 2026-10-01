/**
 * Step 2 of first run. Checks verification by itself — every few seconds while open and
 * whenever the tab/app comes back into focus (the user verifies in their mail app, then
 * returns) — so most people never need the button. Resend has a cooldown so an impatient
 * double tap can't trip Firebase's rate limit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { Button, FormScreen, Icon, PulseRing, Txt } from "@/components";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { toast } from "@/lib/toast";
import { withAlpha } from "@/lib/color";
import { colors, radius, spacing } from "@/theme";

/** Background poll interval while the screen is open. */
const POLL_MS = 5000;
/** Minimum gap between verification emails. */
const RESEND_COOLDOWN_S = 30;

export default function VerifyEmail() {
  const { user, resendVerification, reloadUser, signOutUser } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);

  /** Silent re-check; the root navigator advances on its own once verified. */
  const autoCheck = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await reloadUser();
    } catch {
      // Background checks stay quiet — the manual button reports errors.
    } finally {
      inFlight.current = false;
    }
  }, [reloadUser]);

  useEffect(() => {
    const timer = setInterval(() => void autoCheck(), POLL_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void autoCheck();
    });
    // Web: AppState covers visibilitychange; window focus also fires when the user
    // clicks back from a mail tab that never hid this one (side-by-side windows).
    const onFocus = () => void autoCheck();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(timer);
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [autoCheck]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function check() {
    setError(null);
    setNote(null);
    setChecking(true);
    inFlight.current = true;
    try {
      await reloadUser();
      // If now verified, the root navigator advances automatically. If not, hint the user.
      setNote("Not verified yet. Click the link in your email; this page moves on by itself.");
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setError(null);
    setNote(null);
    setResending(true);
    try {
      await resendVerification();
      toast.success("Verification email sent");
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setResending(false);
    }
  }

  return (
    <FormScreen
      title="Verify your email"
      subtitle="Open the link we emailed you. This page carries on by itself once you have."
      step={2}
      footer={
        <View style={{ alignItems: "center" }}>
          <Button
            variant="ghost"
            size="sm"
            icon="logout"
            style={{ alignSelf: "center" }}
            onPress={() => void signOutUser()}
          >
            Use a different account
          </Button>
        </View>
      }
    >
      <View style={styles.mailCard}>
        <View style={styles.mailIcon}>
          <Icon name="inbox" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={12} color={colors.textDim}>
            Sent to
          </Txt>
          <Txt variant="bodyMedium" size={14.5} numberOfLines={1} selectable>
            {user?.email ?? "your email"}
          </Txt>
        </View>
        <View style={styles.waiting} accessibilityLabel="Waiting for verification">
          {/* A live indicator: we really are checking in the background. */}
          <View style={styles.waitingDotWrap}>
            <PulseRing size={14} color={colors.gold} />
            <View style={styles.waitingDot} />
          </View>
          <Txt variant="mono" size={10.5} color={colors.textDim}>
            WAITING
          </Txt>
        </View>
      </View>
      {note ? (
        <Txt size={13} color={colors.textDim} accessibilityLiveRegion="polite">
          {note}
        </Txt>
      ) : null}
      {error ? (
        <Txt size={13} color={colors.loss} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <Button full size="lg" loading={checking} onPress={check}>
        {checking ? "Checking…" : "I've verified, continue"}
      </Button>
      <Button
        full
        variant="dark"
        icon="refresh"
        loading={resending}
        disabled={cooldown > 0}
        onPress={resend}
      >
        {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend verification email"}
      </Button>
      <Txt size={12} color={colors.textFaint} style={{ lineHeight: 17, textAlign: "center" }}>
        Can't find it? Check spam, or ask whoever runs your league.
      </Txt>
      {__DEV__ ? (
        <Txt size={11.5} color={colors.textFaint} style={{ lineHeight: 17 }}>
          Dev tip: when running against the Auth emulator, no real email is sent. Open the
          verification link from the Emulator UI (Auth tab) or the emulator console output.
        </Txt>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  mailCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  mailIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.1),
  },
  waiting: { flexDirection: "row", alignItems: "center", gap: 6 },
  waitingDotWrap: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  waitingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
});
