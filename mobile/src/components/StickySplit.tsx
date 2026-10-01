/**
 * Two columns where one side pins while the other scrolls (web): the live match card
 * beside the log-match form, the photo beside the stats you're checking, the "waiting on
 * them" list beside the inbox. `Columns` top-aligns its column wrappers, which leaves a
 * `sticky` child no room to travel; here the pinned column stretches to the row's height
 * so its content can stay in view. Stacks (main first) below the breakpoint.
 */
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";

const pin = webStyle({ position: "sticky", top: spacing.lg });

export function StickySplit({
  main,
  aside,
  asideSide = "right",
  ratio = [3, 2],
  gap = spacing.x3,
  style,
}: {
  main: ReactNode;
  /** The pinned column. Omitted (null) → main renders alone. */
  aside?: ReactNode;
  asideSide?: "left" | "right";
  /** Flex weights [main, aside]. */
  ratio?: [number, number];
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDesktop } = useBreakpoint();
  if (!isDesktop || !aside) {
    return (
      <View style={[{ gap }, style]}>
        {main}
        {aside}
      </View>
    );
  }
  const mainCol = (
    <View key="main" style={{ flex: ratio[0], minWidth: 0 }}>
      {main}
    </View>
  );
  // Stretches to the row height (default alignItems) so the pinned child can travel.
  const asideCol = (
    <View key="aside" style={{ flex: ratio[1], minWidth: 0 }}>
      <View style={pin}>{aside}</View>
    </View>
  );
  return (
    <View style={[{ flexDirection: "row", gap }, style]}>
      {asideSide === "left" ? [asideCol, mainCol] : [mainCol, asideCol]}
    </View>
  );
}
