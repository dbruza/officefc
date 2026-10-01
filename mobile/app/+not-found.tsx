/** Themed 404 for stale or mistyped URLs (expo-router's default is an unstyled page). */
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Icon, Reveal, Txt } from "@/components";
import { colors, spacing } from "@/theme";
import { useDocumentTitle } from "@/lib/web";

export default function NotFound() {
  const router = useRouter();
  useDocumentTitle("Page not found");
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bg,
        padding: spacing.x3,
      }}
    >
      <Reveal from="scale" style={{ alignItems: "center" }}>
        <Icon name="ball" size={44} color={colors.accent} stroke={1.8} />
        <Txt variant="monoBold" size={56} style={{ marginTop: spacing.lg, letterSpacing: -2 }}>
          404
        </Txt>
        <Txt variant="head" size={18} style={{ marginTop: spacing.xs }}>
          Off the pitch
        </Txt>
        <Txt
          size={13.5}
          color={colors.textDim}
          style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 320, lineHeight: 20 }}
        >
          That page doesn't exist — the link may be old or mistyped.
        </Txt>
        <Button
          icon="home"
          style={{ marginTop: spacing.x2, alignSelf: "center" }}
          onPress={() => router.replace("/")}
        >
          Back to the league
        </Button>
      </Reveal>
    </View>
  );
}
