/**
 * Web stand-in for pull-to-refresh: an icon button whose glyph spins while a refresh
 * is in flight. Renders nothing on native (RefreshControl covers it there).
 */
import { Platform, View } from "react-native";
import Animated, { type CSSAnimationKeyframes } from "react-native-reanimated";
import { Interactive } from "./Interactive";
import { Icon } from "./Icon";
import { colors, radius } from "@/theme";

const SPIN: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: "0deg" }] },
  to: { transform: [{ rotate: "360deg" }] },
};

export function RefreshButton({
  onPress,
  refreshing,
  size = 40,
}: {
  onPress: () => void;
  refreshing: boolean;
  size?: number;
}) {
  if (Platform.OS !== "web") return null;
  return (
    <Interactive
      onPress={refreshing ? undefined : onPress}
      accessibilityLabel={refreshing ? "Refreshing" : "Refresh"}
      accessibilityState={{ busy: refreshing }}
      pressScale={0.92}
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
      }}
      hoverStyle={{ backgroundColor: colors.surface2, borderColor: colors.lineStrong }}
    >
      {refreshing ? (
        <Animated.View
          style={{
            animationName: SPIN,
            animationDuration: 800,
            animationIterationCount: "infinite",
            animationTimingFunction: "linear",
          }}
        >
          <Icon name="refresh" size={17} color={colors.accent} />
        </Animated.View>
      ) : (
        <View>
          <Icon name="refresh" size={17} color={colors.textDim} />
        </View>
      )}
    </Interactive>
  );
}
