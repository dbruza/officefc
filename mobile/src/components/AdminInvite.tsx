import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button, Card, SectionLabel, Txt } from "@/components";
import { getSeasonJoinCode, rotateSeasonJoinCode } from "@/lib/membership";
import { authErrorMessage } from "@/lib/authErrors";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

/** Admin-only card: shows the shared season join code and lets an admin rotate it. */
export function AdminInvite() {
  const [code, setCode] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);

  const loadCode = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getSeasonJoinCode();
      setCode(res.code);
      setSeasonId(res.seasonId);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCode();
  }, [loadCode]);

  async function rotate() {
    if (!seasonId) return;
    setError(null);
    setRotating(true);
    try {
      const res = await rotateSeasonJoinCode(seasonId);
      setCode(res.code);
      setSeasonId(res.seasonId);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setRotating(false);
    }
  }

  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel>Invite the office</SectionLabel>
      <Card padded>
        <Txt size={13.5} color={colors.textDim} style={{ lineHeight: 20 }}>
          Share this season's join code. Anyone in the office can use it to join — it stays the same
          until you rotate it.
        </Txt>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
        ) : code ? (
          <View style={styles.codeBox}>
            <Txt variant="monoBold" size={22} color={colors.accent} style={{ letterSpacing: 2 }}>
              {code}
            </Txt>
            <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 4 }}>
              Shared code · works for everyone
            </Txt>
          </View>
        ) : null}
        {error ? (
          <Txt size={13} color={colors.loss} style={{ marginTop: spacing.sm }}>
            {error}
          </Txt>
        ) : null}
        <Button
          full
          icon="bolt"
          variant="dark"
          style={{ marginTop: spacing.md }}
          onPress={rotate}
          disabled={loading || rotating || !seasonId}
        >
          {rotating ? "Rotating…" : "Rotate code"}
        </Button>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
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
