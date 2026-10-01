/**
 * Screen title row: optional back button, title + subtitle, right-hand actions. Also
 * sets the browser tab title, and on web offers a refresh button (pull-to-refresh
 * doesn't exist there) when `onRefresh` is given.
 */
import { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { IconButton } from "./Button";
import { RefreshButton } from "./RefreshButton";
import { usePageContext } from "./Page";
import { Txt } from "./Txt";
import { colors, spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { useDocumentTitle } from "@/lib/web";

/** `router.back()` with a fallback: a refreshed or deep-linked web page has no history. */
export function useSafeBack() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace("/(app)/(tabs)"));
}

export function ScreenHeader({
  title,
  subtitle,
  back = true,
  right,
  documentTitle,
  onRefresh,
  refreshing,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  /** Browser tab title when it should differ from `title`. */
  documentTitle?: string;
  /** Web only: show a refresh button that spins while `refreshing`. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const goBack = useSafeBack();
  const { isDesktop } = useBreakpoint();
  // Inside a Page the column wrapper already applies the gutter.
  const inPage = usePageContext() !== null;
  useDocumentTitle(documentTitle ?? title);
  return (
    <View style={[styles.row, inPage && styles.inPage, isDesktop && styles.rowDesktop]}>
      {back ? (
        <IconButton icon="back" accessibilityLabel="Back" onPress={goBack} iconSize={20} />
      ) : null}
      <View style={styles.copy}>
        <Txt
          variant="head"
          size={isDesktop ? 26 : 21}
          numberOfLines={1}
          accessibilityRole="header"
          style={isDesktop ? { letterSpacing: -0.3 } : undefined}
        >
          {title}
        </Txt>
        {subtitle ? (
          <Txt
            size={isDesktop ? 13 : 12}
            color={colors.textDim}
            style={{ marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {onRefresh && Platform.OS === "web" ? (
        <RefreshButton onPress={onRefresh} refreshing={!!refreshing} />
      ) : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  inPage: { paddingHorizontal: 0 },
  rowDesktop: {
    minHeight: 64,
    paddingTop: spacing.x2,
    paddingBottom: spacing.md,
  },
  copy: { flex: 1, minWidth: 0 },
});
