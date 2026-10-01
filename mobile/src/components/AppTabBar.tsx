/**
 * Phone bottom tab bar with the centre "Log match" FAB. A small accent pill slides
 * to the active tab; Home carries a badge while results await your verdict.
 * Hidden from the tablet breakpoint up, where SideNav takes over.
 */
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { type Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { EASE_OUT } from "./motion";
import { Txt } from "./Txt";
import { colors, elevation, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { emitTabRetap } from "@/lib/tabRetap";
import { webStyle } from "@/lib/web";

export type AppTab = "home" | "leaderboard" | "seasons" | "profile";

const TABS: { id: AppTab; label: string; icon: IconName; href: Href }[] = [
  { id: "home", label: "Home", icon: "home", href: "/(app)/(tabs)" },
  { id: "leaderboard", label: "Table", icon: "board", href: "/(app)/(tabs)/leaderboard" },
  { id: "seasons", label: "Seasons", icon: "seasons", href: "/(app)/(tabs)/seasons" },
  { id: "profile", label: "You", icon: "profile", href: "/(app)/(tabs)/profile" },
];

const INDICATOR_WIDTH = 22;

export function AppTabBar({ active, pendingCount = 0 }: { active: AppTab; pendingCount?: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [centres, setCentres] = useState<Partial<Record<AppTab, number>>>({});
  const activeCentre = centres[active];

  const track = (id: AppTab) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    const centre = x + width / 2;
    setCentres((prev) => (prev[id] === centre ? prev : { ...prev, [id]: centre }));
  };

  const press = (tab: (typeof TABS)[number]) =>
    active === tab.id ? emitTabRetap(tab.id) : router.navigate(tab.href);

  const renderTab = (tab: (typeof TABS)[number]) => (
    <TabButton
      key={tab.id}
      tab={tab}
      active={active === tab.id}
      badge={tab.id === "home" ? pendingCount : 0}
      onPress={() => press(tab)}
      onLayout={track(tab.id)}
    />
  );

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { paddingBottom: insets.bottom },
        webStyle({ backdropFilter: "blur(14px)" }),
      ]}
    >
      {activeCentre !== undefined ? (
        <Animated.View
          pointerEvents="none"
          style={{
            ...styles.indicator,
            left: activeCentre - INDICATOR_WIDTH / 2,
            transitionProperty: "left",
            transitionDuration: 300,
            transitionTimingFunction: EASE_OUT,
          }}
        />
      ) : null}
      {TABS.slice(0, 2).map(renderTab)}
      <View style={styles.fabSlot}>
        <Interactive
          onPress={() => router.push("/(app)/log-match")}
          accessibilityLabel="Log match"
          pressScale={0.9}
          style={[styles.fab, webStyle({ boxShadow: elevation.glow })]}
          hoverStyle={{ backgroundColor: mix(colors.accent, "#ffffff", 22) }}
        >
          <Icon name="plus" size={25} stroke={2.7} color={colors.onAccent} />
        </Interactive>
      </View>
      {TABS.slice(2).map(renderTab)}
    </View>
  );
}

function TabButton({
  tab,
  active,
  badge,
  onPress,
  onLayout,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  badge: number;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${tab.label}, ${badge} results awaiting you` : tab.label}
      pressScale={0.92}
      style={styles.tab}
    >
      {({ hovered }) => (
        <>
          <View>
            <Icon
              name={tab.icon}
              size={21}
              stroke={active ? 2.4 : 2}
              color={active ? colors.accent : hovered ? colors.text : colors.textDim}
            />
            {badge ? (
              <View style={styles.badge}>
                <Txt variant="monoBold" size={9} color={colors.onAccent}>
                  {badge}
                </Txt>
              </View>
            ) : null}
          </View>
          <Txt
            variant="head"
            size={10}
            color={active ? colors.accent : hovered ? colors.text : colors.textDim}
          >
            {tab.label}
          </Txt>
        </>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 70,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: withAlpha(colors.bg, 0.92),
    flexDirection: "row",
    alignItems: "flex-start",
  },
  indicator: {
    position: "absolute",
    top: -1,
    width: INDICATOR_WIDTH,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.accent,
  },
  tab: {
    flex: 1,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  fabSlot: { flex: 1, alignItems: "center" },
  fab: {
    width: 54,
    height: 54,
    marginTop: -17,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 5,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
