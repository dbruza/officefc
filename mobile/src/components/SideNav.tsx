/**
 * Desktop / tablet navigation rail. Replaces the bottom tab bar from the tablet
 * breakpoint up and stays put across every (app) screen, not just the four tabs.
 * Full width (labels) on desktop, an icon-only rail on tablets. The active-item
 * highlight slides between entries.
 */
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { type Href, usePathname, useRouter } from "expo-router";
import Animated from "react-native-reanimated";
import { Avatar } from "./Avatar";
import { openCommandPalette } from "./CommandPalette";
import { BrandMark } from "./FormScreen";
import { Icon, type IconName } from "./Icon";
import { Interactive } from "./Interactive";
import { EASE_OUT } from "./motion";
import { Txt } from "./Txt";
import { colors, radius, spacing } from "@/theme";
import { mix, withAlpha } from "@/lib/color";
import { useAuth } from "@/lib/auth";
import { useBreakpoint } from "@/lib/responsive";
import { emitTabRetap } from "@/lib/tabRetap";
import { useHotkey } from "@/lib/web";
import { initialsOf } from "@/types";

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href: Href;
  /** Pathnames (prefix match unless `exact`) that light this item up. */
  match: string[];
  exact?: boolean;
  /** Tab id for scroll-to-top on re-press. */
  tab?: string;
  badge?: number;
}

export const SIDE_NAV_WIDTH = { full: 248, rail: 76 } as const;

export function SideNav({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isDesktop } = useBreakpoint();
  const { user, profile, membership } = useAuth();
  const isAdmin = membership?.role === "admin";
  const full = isDesktop;

  useHotkey("n", () => router.push("/(app)/log-match"), !pathname.startsWith("/log-match"));

  const primary: NavItem[] = [
    {
      id: "home",
      label: "Home",
      icon: "home",
      href: "/(app)/(tabs)",
      match: ["/"],
      exact: true,
      tab: "home",
    },
    {
      id: "table",
      label: "Table",
      icon: "board",
      href: "/(app)/(tabs)/leaderboard",
      match: ["/leaderboard"],
      tab: "leaderboard",
    },
    {
      id: "seasons",
      label: "Seasons",
      icon: "seasons",
      href: "/(app)/(tabs)/seasons",
      match: ["/seasons", "/archive", "/recap"],
      tab: "seasons",
    },
    {
      id: "inbox",
      label: "Inbox",
      icon: "inbox",
      href: "/(app)/confirmations",
      match: ["/confirmations"],
      badge: pendingCount,
    },
  ];
  const secondary: NavItem[] = [
    { id: "games", label: "Your games", icon: "list", href: "/(app)/games", match: ["/games"] },
    { id: "h2h", label: "Head-to-head", icon: "swords", href: "/(app)/h2h", match: ["/h2h"] },
    {
      id: "analytics",
      label: "Analytics",
      icon: "trend",
      href: "/(app)/analytics",
      match: ["/analytics"],
    },
    {
      id: "settings",
      label: "Settings",
      icon: "settings",
      href: "/(app)/settings",
      match: ["/settings", "/changelog", "/edit-profile"],
    },
    ...(isAdmin
      ? [
          {
            id: "admin",
            label: "Admin",
            icon: "shield" as IconName,
            href: "/(app)/admin" as Href,
            match: ["/admin"],
          },
        ]
      : []),
  ];
  const all = [...primary, ...secondary];
  const isActive = (item: NavItem) =>
    item.match.some((m) =>
      item.exact ? pathname === m : pathname === m || pathname.startsWith(`${m}/`),
    );
  const activeId =
    all.find(isActive)?.id ??
    (pathname.startsWith("/profile") || pathname.startsWith("/player") ? "you" : undefined);

  // Highlight geometry per item, measured relative to the nav column.
  const [layouts, setLayouts] = useState<Record<string, { y: number; h: number }>>({});
  const [groupOffset, setGroupOffset] = useState<Record<string, number>>({});
  const track = (id: string) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setLayouts((prev) =>
      prev[id]?.y === y && prev[id]?.h === height ? prev : { ...prev, [id]: { y, h: height } },
    );
  };
  const trackGroup = (group: string) => (e: LayoutChangeEvent) => {
    const { y } = e.nativeEvent.layout;
    setGroupOffset((prev) => (prev[group] === y ? prev : { ...prev, [group]: y }));
  };
  const activeGroup = primary.some((i) => i.id === activeId) ? "primary" : "secondary";
  const activeLayout = activeId ? layouts[activeId] : undefined;
  const highlightTop =
    activeLayout && groupOffset[activeGroup] !== undefined
      ? groupOffset[activeGroup] + activeLayout.y
      : undefined;

  const go = (item: NavItem) => {
    if (isActive(item) && item.tab) emitTabRetap(item.tab);
    else router.navigate(item.href);
  };

  const me = profile
    ? {
        id: user?.uid ?? "me",
        name: profile.displayName,
        handle: profile.handle,
        jersey: profile.jersey,
        color: profile.color,
        initials: initialsOf(profile.displayName),
        isYou: true,
      }
    : null;

  return (
    <View
      style={[styles.nav, { width: full ? SIDE_NAV_WIDTH.full : SIDE_NAV_WIDTH.rail }]}
      role="navigation"
    >
      <View style={[styles.brand, !full && { alignItems: "center", paddingHorizontal: 0 }]}>
        {full ? <BrandMark /> : <Icon name="ball" size={24} color={colors.accent} stroke={2.2} />}
      </View>

      <Interactive
        onPress={() => router.push("/(app)/log-match")}
        accessibilityLabel="Log match (shortcut N)"
        pressScale={0.97}
        style={[styles.cta, !full && styles.ctaRail]}
        hoverStyle={{ backgroundColor: mix(colors.accent, "#ffffff", 22) }}
      >
        <Icon name="plus" size={full ? 18 : 22} stroke={2.7} color={colors.onAccent} />
        {full ? (
          <>
            <Txt variant="head" size={14.5} color={colors.onAccent} style={{ flex: 1 }}>
              Log match
            </Txt>
            <View style={styles.kbd}>
              <Txt variant="monoBold" size={10.5} color={withAlpha(colors.onAccent, 0.7)}>
                N
              </Txt>
            </View>
          </>
        ) : null}
      </Interactive>

      <Interactive
        onPress={openCommandPalette}
        accessibilityLabel="Search players and screens (Command K)"
        pressScale={0.98}
        style={[styles.search, !full && styles.itemRail]}
        hoverStyle={{ borderColor: colors.lineStrong, backgroundColor: colors.surface2 }}
      >
        <Icon name="search" size={full ? 16 : 20} color={colors.textDim} />
        {full ? (
          <>
            <Txt size={13.5} color={colors.textDim} style={{ flex: 1 }}>
              Search
            </Txt>
            <Txt variant="mono" size={11} color={colors.textFaint}>
              ⌘K
            </Txt>
          </>
        ) : null}
      </Interactive>

      <View style={styles.lists}>
        {highlightTop !== undefined && activeLayout ? (
          <Animated.View
            pointerEvents="none"
            style={{
              ...styles.highlight,
              top: highlightTop,
              height: activeLayout.h,
              transitionProperty: ["top", "height"],
              transitionDuration: 280,
              transitionTimingFunction: EASE_OUT,
            }}
          >
            <View style={styles.highlightBar} />
          </Animated.View>
        ) : null}

        <View onLayout={trackGroup("primary")} style={styles.group}>
          {primary.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              active={activeId === item.id}
              full={full}
              onPress={() => go(item)}
              onLayout={track(item.id)}
            />
          ))}
        </View>

        <View style={styles.divider} />
        {full ? (
          <Txt variant="head" size={10} color={colors.textFaint} style={styles.groupLabel}>
            MORE
          </Txt>
        ) : null}

        <View onLayout={trackGroup("secondary")} style={styles.group}>
          {secondary.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              active={activeId === item.id}
              full={full}
              onPress={() => go(item)}
              onLayout={track(item.id)}
            />
          ))}
        </View>
      </View>

      {me ? (
        <Interactive
          onPress={() =>
            activeId === "you" ? emitTabRetap("profile") : router.navigate("/(app)/(tabs)/profile")
          }
          accessibilityLabel="Your profile"
          style={[
            styles.me,
            !full && { justifyContent: "center", paddingHorizontal: 0 },
            activeId === "you" && styles.meActive,
          ]}
          hoverStyle={{ backgroundColor: colors.surface2 }}
        >
          <Avatar player={me} size={full ? 36 : 40} ring={activeId === "you"} jersey />
          {full ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="bodyMedium" size={13.5} numberOfLines={1}>
                {profile?.displayName}
              </Txt>
              <Txt size={11.5} color={colors.textDim} numberOfLines={1}>
                @{profile?.handle}
                {isAdmin ? " · admin" : ""}
              </Txt>
            </View>
          ) : null}
        </Interactive>
      ) : null}
    </View>
  );
}

function NavRow({
  item,
  active,
  full,
  onPress,
  onLayout,
}: {
  item: NavItem;
  active: boolean;
  full: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Interactive
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="link"
      accessibilityLabel={item.badge ? `${item.label}, ${item.badge} waiting` : item.label}
      accessibilityState={{ selected: active }}
      pressScale={0.98}
      style={[styles.item, !full && styles.itemRail]}
      hoverStyle={active ? undefined : { backgroundColor: withAlpha("#ffffff", 0.04) }}
    >
      {({ hovered }) => (
        <>
          <View>
            <Icon
              name={item.icon}
              size={full ? 19 : 22}
              stroke={active ? 2.4 : 2}
              color={active ? colors.accent : hovered ? colors.text : colors.textDim}
            />
            {!full && item.badge ? <View style={styles.dot} /> : null}
          </View>
          {full ? (
            <Txt
              variant={active ? "head" : "bodyMedium"}
              size={14}
              color={active ? colors.text : hovered ? colors.text : colors.textDim}
              style={{ flex: 1 }}
            >
              {item.label}
            </Txt>
          ) : null}
          {full && item.badge ? (
            <View style={styles.badge}>
              <Txt variant="monoBold" size={10} color={colors.onAccent}>
                {item.badge}
              </Txt>
            </View>
          ) : null}
        </>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  nav: {
    height: "100%",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    backgroundColor: mix(colors.bg, colors.surface, 45),
  },
  brand: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.x2 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    marginBottom: spacing.lg,
  },
  ctaRail: {
    width: 48,
    height: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: "center",
    alignSelf: "center",
    borderRadius: radius.pill,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 38,
    paddingHorizontal: 12,
    marginBottom: spacing.lg,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  kbd: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: withAlpha(colors.onAccent, 0.25),
  },
  lists: { flex: 1 },
  group: { gap: 2 },
  groupLabel: { letterSpacing: 1.4, paddingHorizontal: 12, marginBottom: 6 },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.md,
    marginHorizontal: 8,
  },
  highlight: {
    position: "absolute",
    left: 0,
    right: 0,
    borderRadius: radius.sm + 2,
    backgroundColor: withAlpha(colors.accent, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.16),
    justifyContent: "center",
  },
  highlightBar: {
    position: "absolute",
    left: -spacing.md - 1,
    width: 3,
    height: 18,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.accent,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: radius.sm + 2,
  },
  itemRail: { justifyContent: "center", paddingHorizontal: 0, height: 46 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  me: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  meActive: {
    borderColor: withAlpha(colors.accent, 0.25),
    backgroundColor: withAlpha(colors.accent, 0.06),
  },
});
