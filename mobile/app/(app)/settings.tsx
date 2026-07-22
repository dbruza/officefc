import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Button, Card, Icon, ScreenHeader, SectionLabel, Txt, type IconName } from "@/components";
import { useAuth } from "@/lib/auth";
import { confirmAction } from "@/lib/dialogs";
import { colors, radius, spacing } from "@/theme";

export default function Settings() {
  const router = useRouter();
  const { user, membership, signOutUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const version = Constants.expoConfig?.version ?? "dev";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionLabel>Account</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row icon="profile" label="Signed in as" value={user?.email ?? "—"} />
          <Row
            icon="edit"
            label="Edit profile"
            chevron
            onPress={() => router.push("/(app)/edit-profile")}
          />
        </Card>

        <SectionLabel style={{ marginTop: spacing.x2 }}>League</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row icon="jersey" label="Role" value={(membership?.role ?? "member").toUpperCase()} />
          {isAdmin ? (
            <Row
              icon="shield"
              label="Admin tools"
              chevron
              onPress={() => router.push("/(app)/admin")}
            />
          ) : null}
        </Card>

        <SectionLabel style={{ marginTop: spacing.x2 }}>About</SectionLabel>
        <Card style={styles.group} padded={false}>
          <Row icon="info" label="Version" value={`OfficeFC ${version}`} />
        </Card>

        <Button
          full
          variant="ghost"
          style={{ marginTop: spacing.x3 }}
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
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  chevron,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={16} color={colors.textDim} />
      </View>
      <Txt variant="bodyMedium" size={13.5} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="mono" size={12} color={colors.textDim} numberOfLines={1}>
          {value}
        </Txt>
      ) : null}
      {chevron ? <Icon name="chevron" size={15} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.x3 },
  group: { overflow: "hidden" },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
});
