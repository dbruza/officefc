/**
 * Segmented control with a sliding active pill. Options measure themselves, and the
 * pill transitions its left/width (Reanimated CSS transition) to the selected one.
 */
import { useState } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { Interactive } from "./Interactive";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";
import { EASE_OUT } from "./motion";
import { colors, radius } from "@/theme";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Small count shown after the label (e.g. pending items). */
  badge?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  full = true,
  style,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Stretch options to fill the width (default) vs hug their labels. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const height = size === "sm" ? 32 : 40;
  // Equal-width options: place the pill by percentage, no measuring. react-native-web only
  // reports size changes, so a measured pill would drift when the control moves sideways.
  const index = options.findIndex((o) => o.value === value);
  const share = 100 / Math.max(options.length, 1);
  const active: { left: number | `${number}%`; width: number | `${number}%` } | undefined = full
    ? index >= 0
      ? { left: `${index * share}%`, width: `${share}%` }
      : undefined
    : layouts[value]
      ? { left: layouts[value].x, width: layouts[value].width }
      : undefined;

  const onItemLayout = (key: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) =>
      prev[key]?.x === x && prev[key]?.width === width ? prev : { ...prev, [key]: { x, width } },
    );
  };

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { height: height + 8 }, !full && { alignSelf: "flex-start" }, style]}
    >
      <View style={styles.inner}>
        {active ? (
          <Animated.View
            pointerEvents="none"
            style={{
              ...styles.pill,
              height,
              left: active.left,
              width: active.width,
              transitionProperty: ["left", "width"],
              transitionDuration: 260,
              transitionTimingFunction: EASE_OUT,
            }}
          />
        ) : null}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Interactive
              key={option.value}
              onLayout={full ? undefined : onItemLayout(option.value)}
              onPress={() => onChange(option.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              pressScale={0.97}
              style={[
                styles.item,
                { height, paddingHorizontal: size === "sm" ? 12 : 16 },
                full && { flex: 1 },
                // Before the first measure, paint the selected item itself so there's no
                // frame without an active state.
                selected && !active && { backgroundColor: colors.surface3 },
              ]}
            >
              {({ hovered }) => (
                <>
                  {option.icon ? (
                    <Icon
                      name={option.icon}
                      size={size === "sm" ? 14 : 16}
                      color={selected ? colors.text : hovered ? colors.text : colors.textDim}
                    />
                  ) : null}
                  <Txt
                    variant="head"
                    size={size === "sm" ? 12 : 13.5}
                    color={selected || hovered ? colors.text : colors.textDim}
                  >
                    {option.label}
                  </Txt>
                  {option.badge ? (
                    <View style={styles.badge}>
                      <Txt variant="monoBold" size={9.5} color={colors.onAccent}>
                        {option.badge}
                      </Txt>
                    </View>
                  ) : null}
                </>
              )}
            </Interactive>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // flexGrow (not flex: 1) so a hugging control still sizes to its options on native.
  inner: { flexGrow: 1, flexDirection: "row", alignItems: "center" },
  pill: {
    position: "absolute",
    top: 0,
    borderRadius: radius.sm + 1,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.sm + 1,
  },
  badge: {
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
