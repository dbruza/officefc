/**
 * Admin-only: the season's shared join code, with one-tap copy of the code or of an
 * invite link (/join?code=…, which prefills the join step). Native has no clipboard
 * module installed, so it offers the share sheet instead (which includes Copy). Rotating
 * kills the old code for everyone, so it asks first.
 *
 * `variant="section"` (default) is the Home card; `"tile"` is the admin overview tile.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform, Share, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Button, IconButton } from "./Button";
import { Card } from "./Card";
import { ErrorCard } from "./feedback";
import { Icon } from "./Icon";
import { Skeleton } from "./motion";
import { SectionLabel } from "./SectionLabel";
import { Txt } from "./Txt";
import { getSeasonJoinCode, rotateSeasonJoinCode } from "@/lib/membership";
import { callableErrorMessage } from "@/lib/authErrors";
import { confirmAction } from "@/lib/dialogs";
import { copyText, inviteLinkFor } from "@/lib/inviteLink";
import { toast } from "@/lib/toast";
import { colors, radius, spacing } from "@/theme";
import { withAlpha } from "@/lib/color";

const IS_WEB = Platform.OS === "web";

export function AdminInvite({
  variant = "section",
  style,
}: {
  variant?: "section" | "tile";
  /** Tile only: extra card style (e.g. flex: 1 to match its row in a grid). */
  style?: StyleProp<ViewStyle>;
}) {
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
      setError(callableErrorMessage(e, "Couldn't load the join code."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCode();
  }, [loadCode]);

  function rotate() {
    if (!seasonId) return;
    confirmAction({
      title: "Rotate the join code?",
      message:
        "The current code and every invite link built from it stop working immediately. Members who already joined aren't affected.",
      confirmLabel: "Rotate code",
      destructive: true,
      onConfirm: async () => {
        setError(null);
        setRotating(true);
        try {
          const res = await rotateSeasonJoinCode(seasonId);
          setCode(res.code);
          setSeasonId(res.seasonId);
          toast.success(`New code: ${res.code}`);
        } catch (e) {
          setError(callableErrorMessage(e, "Couldn't rotate the code."));
        } finally {
          setRotating(false);
        }
      },
    });
  }

  async function copy(text: string, what: string) {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error(`Couldn't copy. Select the ${what.toLowerCase()} and copy it manually.`);
  }

  async function share() {
    if (!code) return;
    try {
      await Share.share({
        message: `Join our OfficeFC league: ${inviteLinkFor(code)} (code ${code})`,
      });
    } catch {
      // Dismissed or unavailable — nothing to report.
    }
  }

  const tile = variant === "tile";
  const ready = !!code && !loading;

  const copyCode = () => code && void copy(code, "Code");
  const copyLink = () => code && void copy(inviteLinkFor(code), "Invite link");

  const codeBox = loading ? (
    <View style={[styles.codeBox, tile && styles.codeBoxTile]}>
      <Skeleton width={150} height={tile ? 22 : 26} />
    </View>
  ) : code ? (
    <View style={[styles.codeBox, tile && styles.codeBoxTile]}>
      {tile && IS_WEB ? (
        <IconButton
          icon="copy"
          accessibilityLabel="Copy join code"
          size={30}
          iconSize={15}
          tone="ghost"
          onPress={copyCode}
          style={styles.codeCopy}
        />
      ) : null}
      <Txt
        variant="monoBold"
        size={tile ? 20 : 24}
        color={colors.accent}
        style={{ letterSpacing: 2 }}
        selectable
        accessibilityLabel={`Join code ${code.split("").join(" ")}`}
      >
        {code}
      </Txt>
      {tile ? null : (
        <Txt size={11.5} color={colors.textFaint} style={{ marginTop: 4 }}>
          One shared code · works for everyone
        </Txt>
      )}
    </View>
  ) : null;

  const actions = (
    <View style={styles.actions}>
      {IS_WEB ? (
        <>
          {tile ? null : (
            <Button size="sm" icon="copy" disabled={!ready} onPress={copyCode}>
              Copy code
            </Button>
          )}
          <Button size="sm" variant="dark" icon="link" disabled={!ready} onPress={copyLink}>
            {tile ? "Copy link" : "Copy invite link"}
          </Button>
        </>
      ) : (
        <Button size="sm" icon="share" disabled={!ready} onPress={() => void share()}>
          {tile ? "Share" : "Share invite"}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon="refresh"
        loading={rotating}
        disabled={loading || !seasonId}
        onPress={rotate}
        accessibilityLabel="Rotate join code"
      >
        Rotate
      </Button>
    </View>
  );

  if (tile) {
    return (
      <Card style={[styles.tile, style]}>
        <View style={styles.tileHead}>
          <Icon name="users" size={15} color={colors.textDim} />
          <Txt variant="head" size={11} color={colors.textDim} style={{ letterSpacing: 1.2 }}>
            JOIN CODE
          </Txt>
        </View>
        {error && !code ? (
          <ErrorCard message={error} onRetry={() => void loadCode()} retrying={loading} />
        ) : (
          codeBox
        )}
        {actions}
        {error && code ? (
          <Txt size={12} color={colors.loss}>
            {error}
          </Txt>
        ) : null}
      </Card>
    );
  }

  return (
    <View style={{ marginTop: spacing.x2 }}>
      <SectionLabel>Invite the office</SectionLabel>
      <Card padded>
        <Txt size={13.5} color={colors.textDim} style={{ lineHeight: 20 }}>
          Share the invite link (it fills the code in for them) or the code itself. It stays the
          same until you rotate it.
        </Txt>
        {error && !code ? (
          <ErrorCard
            message={error}
            onRetry={() => void loadCode()}
            retrying={loading}
            style={{ marginTop: spacing.md }}
          />
        ) : (
          codeBox
        )}
        {error && code ? (
          <Txt size={13} color={colors.loss} style={{ marginTop: spacing.sm }}>
            {error}
          </Txt>
        ) : null}
        <View style={{ marginTop: spacing.md }}>{actions}</View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  codeBox: {
    marginTop: spacing.md,
    minHeight: 84,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxTile: { marginTop: 0, minHeight: 0, paddingVertical: spacing.md },
  codeCopy: { position: "absolute", right: 6, top: 6, borderWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: { gap: spacing.md },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6 },
});
