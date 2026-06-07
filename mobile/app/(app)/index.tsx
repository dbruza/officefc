/**
 * Home (M1). Confirms the auth + membership loop works end-to-end: greets the signed-in
 * player, shows their role, lets admins mint invite codes, and signs out. The full
 * dashboard (standings, form, ELO) lands in M3 once match data exists.
 */
import { useState } from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Txt, Card, Button, Avatar, SectionLabel } from "@/components";
import { useAuth } from "@/lib/auth";
import { createInvite } from "@/lib/membership";
import { authErrorMessage } from "@/lib/authErrors";
import { initialsOf, type Player } from "@/types";
import { colors, spacing, radius } from "@/theme";
import { mix, withAlpha } from "@/lib/color";

export default function Home() {
  const { user, profile, membership, signOutUser } = useAuth();
  const isAdmin = membership?.role === "admin";

  const me: Player | null = profile
    ? {
        id: user?.uid ?? "me",
        name: profile.displayName,
        handle: profile.handle,
        jersey: profile.jersey,
        color: profile.color,
        initials: initialsOf(profile.displayName),
        isYou: true,
      }
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="head" size={10.5} color={colors.textDim} style={{ letterSpacing: 1.6 }}>
              OFFICEFC · SUMMER SHOWDOWN
            </Txt>
            <Txt variant="head" size={24} numberOfLines={1} style={{ marginTop: 2 }}>
              Hey, {profile?.displayName?.split(" ")[0] ?? "player"}
            </Txt>
          </View>
          {me ? <Avatar player={me} size={44} ring jersey /> : null}
        </View>

        <Card style={styles.hero} padded>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt variant="head" size={11} color={colors.textDim} style={{ letterSpacing: 1.4 }}>
              YOU'RE IN THE LEAGUE
            </Txt>
            <View style={[styles.roleChip, isAdmin && { backgroundColor: colors.accent }]}>
              <Txt variant="monoBold" size={10} color={isAdmin ? colors.onAccent : colors.textDim} style={{ letterSpacing: 1 }}>
                {(membership?.role ?? "member").toUpperCase()}
              </Txt>
            </View>
          </View>
          <Txt size={13.5} color={colors.textDim} style={{ marginTop: 8, lineHeight: 20 }}>
            Match logging, opponent confirmation, and the live table arrive next (M2–M3). For now,
            your account, profile, and membership are all set.
          </Txt>
        </Card>

        {isAdmin ? <AdminInvite /> : null}

        <View style={{ height: spacing.x3 }} />
        <Button full variant="ghost" onPress={signOutUser}>
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function AdminInvite() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const res = await createInvite("member", 14);
      setCode(res.code);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel>Invite the office</SectionLabel>
      <Card padded>
        <Txt size={13.5} color={colors.textDim} style={{ lineHeight: 20 }}>
          Generate a code and share it with a colleague. They enter it after signing up to join the
          league.
        </Txt>
        {code ? (
          <View style={styles.codeBox}>
            <Txt variant="monoBold" size={22} color={colors.accent} style={{ letterSpacing: 2 }}>
              {code}
            </Txt>
            <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 4 }}>
              Valid for 14 days · one use
            </Txt>
          </View>
        ) : null}
        {error ? (
          <Txt size={13} color={colors.loss} style={{ marginTop: spacing.sm }}>
            {error}
          </Txt>
        ) : null}
        <Button full icon="plus" style={{ marginTop: spacing.md }} onPress={generate}>
          {busy ? "Generating…" : code ? "Generate another" : "Generate invite code"}
        </Button>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.x3 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  hero: {
    backgroundColor: mix(colors.surface, colors.accent, 6),
    borderColor: withAlpha(colors.accent, 0.22),
    borderRadius: radius.xl,
  },
  roleChip: {
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  codeBox: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
});
