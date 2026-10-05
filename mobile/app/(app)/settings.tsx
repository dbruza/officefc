/**
 * Settings: league admin (for admins, first), account, notification categories, privacy
 * and safety (AI photo reading, blocks, account deletion), and about. Rows are single pressables — a toggle row IS the switch (role="switch"), so
 * there's no nested Switch control to double-fire or to nest inside a <button> on web.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import Animated from "react-native-reanimated";
import {
  Avatar,
  Button,
  Card,
  EASE_OUT,
  Icon,
  Interactive,
  Page,
  Reveal,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  Tag,
  Txt,
  useLegalSheet,
  type IconName,
} from "@/components";
import { useAuth } from "@/lib/auth";
import { confirmAction } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { isUnseen, latestVersion, useChangelogLastSeen } from "@/lib/changelogSeen";
import { withAlpha } from "@/lib/color";
import { initialsOf, type Player } from "@/types";
import { colors, radius, spacing } from "@/theme";
import {
  PUSH_CATEGORIES,
  loadPushPrefs,
  toggleCategory,
  type PushCategoryKey,
} from "@/lib/league/pushPrefs";
import { getAiPhotoConsent, setAiPhotoConsent } from "@/lib/privacySettings";
import { AI_FEATURES } from "@/lib/constants";

const IS_WEB = Platform.OS === "web";

export default function Settings() {
  const router = useRouter();
  const { user, profile, membership, signOutUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const version = Constants.expoConfig?.version ?? "dev";
  const { lastSeen, loaded: seenLoaded } = useChangelogLastSeen();
  const latest = latestVersion();
  const hasNews = seenLoaded && !!latest && isUnseen(latest, lastSeen);
  const legal = useLegalSheet();

  // Muted categories as stored server-side; empty set = everything delivers.
  const [muted, setMuted] = useState<ReadonlySet<PushCategoryKey>>(new Set());
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [busy, setBusy] = useState<PushCategoryKey | null>(null);
  // Synchronous twin of `busy` so rapid taps serialize before React re-renders.
  const busyRef = useRef(false);
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadPushPrefs(uid)
      .then((list) => {
        if (!cancelled) setMuted(new Set(list));
      })
      .catch(() => {
        // Leave the default of nothing muted — the backend delivers by default too,
        // so the UI stays honest about what will actually happen.
      })
      .finally(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  /** Optimistic flip with revert-on-failure; one write at a time. */
  async function handleToggle(category: PushCategoryKey, mute: boolean) {
    if (!uid || busyRef.current) return;
    const previous = muted;
    busyRef.current = true;
    setBusy(category);
    setMuted((current) => {
      const next = new Set(current);
      if (mute) next.add(category);
      else next.delete(category);
      return next;
    });
    try {
      setMuted(new Set(await toggleCategory(uid, category, mute)));
    } catch {
      setMuted(previous);
      toast.error("Couldn't update notifications. Check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  // AI photo reading consent; null until loaded.
  const [aiPhotos, setAiPhotos] = useState<boolean | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!uid || !AI_FEATURES) return;
    let cancelled = false;
    getAiPhotoConsent(uid)
      .then((allowed) => {
        if (!cancelled) setAiPhotos(allowed);
      })
      .catch(() => {
        if (!cancelled) setAiPhotos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function saveAiPhotos(allowed: boolean) {
    if (!uid) return;
    setAiBusy(true);
    try {
      await setAiPhotoConsent(uid, allowed);
      setAiPhotos(allowed);
      toast.success(allowed ? "AI photo reading on" : "AI photo reading off");
    } catch {
      toast.error("Couldn't save that. Check your connection and try again.");
    } finally {
      setAiBusy(false);
    }
  }

  /** Turning it on gets the same disclosure as the photo screen; turning it off is instant. */
  function toggleAiPhotos() {
    if (aiPhotos === null || aiBusy) return;
    if (aiPhotos) return void saveAiPhotos(false);
    confirmAction({
      title: "Allow AI photo reading?",
      message:
        "When you log a match from a photo, that photo is sent through OpenRouter to Meta's Muse Spark AI model to read the score and stats. Nothing else about you is sent. You can turn this off any time.",
      confirmLabel: "Allow",
      onConfirm: () => saveAiPhotos(true),
    });
  }

  const me: Player | null = useMemo(
    () =>
      profile && uid
        ? {
            id: uid,
            name: profile.displayName,
            handle: profile.handle,
            jersey: profile.jersey,
            color: profile.color,
            initials: initialsOf(profile.displayName),
          }
        : null,
    [profile, uid],
  );

  return (
    <Page width="narrow" header={<ScreenHeader title="Settings" />}>
      {isAdmin ? (
        <Reveal index={0}>
          <SectionLabel>League admin</SectionLabel>
          <Card style={styles.group} padded={false}>
            <NavRow
              icon="shield"
              label="Admin dashboard"
              detail="Seasons, results queue, teams, invite code"
              onPress={() => router.push("/(app)/admin")}
              last
            />
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={1} style={isAdmin ? styles.section : undefined}>
        <SectionLabel>Account</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Interactive
            accessibilityRole="link"
            accessibilityLabel="Edit profile"
            onPress={() => router.push("/(app)/edit-profile")}
            pressScale={0.99}
            style={[styles.row, styles.profileRow]}
            hoverStyle={styles.rowHover}
          >
            <Avatar player={me} size={44} jersey />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="head" size={15} numberOfLines={1}>
                {profile?.displayName ?? "Your profile"}
              </Txt>
              <Txt size={12} color={colors.textDim} numberOfLines={1}>
                {profile ? `@${profile.handle} · #${profile.jersey}` : "Set your name and colours"}
              </Txt>
            </View>
            <Txt variant="head" size={12.5} color={colors.accent}>
              Edit
            </Txt>
            <Icon name="chevron" size={15} color={colors.textFaint} />
          </Interactive>
          <View style={[styles.row, styles.lastRow]}>
            <RowIcon icon="profile" />
            <Txt variant="bodyMedium" size={13.5} style={{ flex: 1 }} numberOfLines={1}>
              Signed in as
            </Txt>
            <Txt
              variant="mono"
              size={12}
              color={colors.textDim}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
              selectable
            >
              {user?.email ?? "—"}
            </Txt>
          </View>
        </Card>
      </Reveal>

      {uid ? (
        <Reveal index={2} style={styles.section}>
          <SectionLabel>Notifications</SectionLabel>
          {IS_WEB ? (
            <View style={styles.note}>
              <Icon name="bell" size={15} color={colors.textDim} />
              <Txt size={12.5} color={colors.textDim} style={{ flex: 1, lineHeight: 18 }}>
                Push notifications go to the OfficeFC phone app. These switches choose what it sends
                you, wherever you change them.
              </Txt>
            </View>
          ) : null}
          <Card style={styles.group} padded={false}>
            {PUSH_CATEGORIES.map((category, i) => {
              const on = !muted.has(category.key);
              return (
                <Interactive
                  key={category.key}
                  accessibilityRole="switch"
                  accessibilityLabel={`${category.label} notifications`}
                  accessibilityState={{ checked: on, busy: busy === category.key }}
                  disabled={!prefsLoaded || (busy !== null && busy !== category.key)}
                  onPress={() => void handleToggle(category.key, on)}
                  pressScale={0.99}
                  style={[styles.row, i === PUSH_CATEGORIES.length - 1 && styles.lastRow]}
                  hoverStyle={styles.rowHover}
                >
                  <RowIcon icon={category.icon} />
                  <Txt variant="bodyMedium" size={13.5} style={{ flex: 1 }} numberOfLines={1}>
                    {category.label}
                  </Txt>
                  {prefsLoaded ? (
                    <Toggle on={on} />
                  ) : (
                    <Skeleton width={42} height={24} round={12} />
                  )}
                </Interactive>
              );
            })}
          </Card>
        </Reveal>
      ) : null}

      {uid ? (
        <Reveal index={3} style={styles.section}>
          <SectionLabel>Privacy & safety</SectionLabel>
          <Card style={styles.group} padded={false}>
            {AI_FEATURES ? (
              <Interactive
                accessibilityRole="switch"
                accessibilityLabel="AI photo reading"
                accessibilityState={{ checked: aiPhotos === true, busy: aiBusy }}
                disabled={aiPhotos === null || aiBusy}
                onPress={toggleAiPhotos}
                pressScale={0.99}
                style={styles.row}
                hoverStyle={styles.rowHover}
              >
                <RowIcon icon="camera" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                    AI photo reading
                  </Txt>
                  <Txt
                    size={11.5}
                    color={colors.textDim}
                    numberOfLines={2}
                    style={{ marginTop: 1 }}
                  >
                    Send stats photos to an AI model to fill in the match
                  </Txt>
                </View>
                {aiPhotos === null ? (
                  <Skeleton width={42} height={24} round={12} />
                ) : (
                  <Toggle on={aiPhotos} />
                )}
              </Interactive>
            ) : null}
            <NavRow
              icon="eyeOff"
              label="Blocked players"
              detail="Unblock someone you blocked"
              onPress={() => router.push("/(app)/blocked")}
            />
            <NavRow
              icon="x"
              label="Delete account"
              detail="Erase your login, profile and photos"
              onPress={() => router.push("/(app)/delete-account")}
              last
            />
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={4} style={styles.section}>
        <SectionLabel>About</SectionLabel>
        <Card style={styles.group} padded={false}>
          <NavRow
            icon="sparkle"
            label="What's new"
            detail={`OfficeFC ${version}`}
            badge={hasNews ? "NEW" : undefined}
            onPress={() => router.push("/(app)/changelog")}
          />
          <NavRow icon="shield" label="Privacy policy" onPress={() => legal.open("/privacy")} />
          <NavRow icon="list" label="Terms of use" onPress={() => legal.open("/terms")} />
          <NavRow
            icon="inbox"
            label="Help & support"
            detail="Contact us, FAQs"
            onPress={() => legal.open("/support")}
            last
          />
        </Card>
        {legal.sheet}
      </Reveal>

      <Reveal index={5} style={{ marginTop: spacing.x3 }}>
        <Button
          full
          variant="ghost"
          icon="logout"
          onPress={() =>
            confirmAction({
              title: "Sign out?",
              message: "You can sign back in any time — your record stays on the table.",
              confirmLabel: "Sign out",
              destructive: true,
              onConfirm: () => void signOutUser(),
            })
          }
        >
          Sign out
        </Button>
      </Reveal>
    </Page>
  );
}

function RowIcon({ icon }: { icon: IconName }) {
  return (
    <View style={styles.rowIcon}>
      <Icon name={icon} size={16} color={colors.textDim} />
    </View>
  );
}

function NavRow({
  icon,
  label,
  detail,
  badge,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  badge?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Interactive
      accessibilityRole="link"
      accessibilityLabel={badge ? `${label}, ${badge.toLowerCase()}` : label}
      onPress={onPress}
      pressScale={0.99}
      style={[styles.row, last && styles.lastRow]}
      hoverStyle={styles.rowHover}
    >
      <RowIcon icon={icon} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
          {label}
        </Txt>
        {detail ? (
          <Txt size={11.5} color={colors.textDim} numberOfLines={1} style={{ marginTop: 1 }}>
            {detail}
          </Txt>
        ) : null}
      </View>
      {badge ? (
        <View style={{ alignSelf: "center" }}>
          <Tag tone="accent">{badge}</Tag>
        </View>
      ) : null}
      <Icon name="chevron" size={15} color={colors.textFaint} />
    </Interactive>
  );
}

/**
 * Visual-only switch (the row carries role="switch" and handles the press). The knob
 * slides with a CSS transition on both platforms via Reanimated.
 */
function Toggle({ on }: { on: boolean }) {
  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: on ? colors.accent : colors.surface2,
          borderColor: on ? colors.accent : colors.line,
        },
      ]}
    >
      <Animated.View
        style={{
          ...styles.knob,
          backgroundColor: on ? colors.onAccent : colors.textFaint,
          transform: [{ translateX: on ? 18 : 0 }],
          transitionProperty: ["transform", "backgroundColor"],
          transitionDuration: 180,
          transitionTimingFunction: EASE_OUT,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.x2 },
  group: { overflow: "hidden" },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  lastRow: { borderBottomWidth: 0 },
  rowHover: { backgroundColor: colors.surface2 },
  profileRow: { minHeight: 68 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: withAlpha(colors.surface, 0.6),
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    padding: 2,
    justifyContent: "center",
  },
  knob: { width: 20, height: 20, borderRadius: 10 },
});
