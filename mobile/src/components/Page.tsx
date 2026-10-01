/**
 * Screen scaffold + responsive layout primitives.
 *
 * `Page` replaces the SafeAreaView → header → ScrollView(+RefreshControl) block every
 * screen used to hand-roll. It centres content at a max width with gutters that grow
 * with the viewport, keeps the header aligned to the same column, and only mounts
 * RefreshControl on native (web gets `ScreenHeader`'s refresh button instead).
 *
 * `Columns` splits into side-by-side columns from a breakpoint up (stacked below), and
 * `Grid` lays tiles out in as many columns as fit a minimum tile width.
 */
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { Reveal } from "./motion";
import { colors, contentWidth, motion, spacing } from "@/theme";
import { useBreakpoint } from "@/lib/responsive";
import { webStyle } from "@/lib/web";

/** Lets children (ScreenHeader) know they sit inside a Page that already applies gutters. */
export const PageContext = createContext<{ gutter: number } | null>(null);
export const usePageContext = () => useContext(PageContext);

/** Horizontal gutter for the current viewport: 16 phone / 24 tablet / 40 desktop. */
export function useGutter(): number {
  const { isTablet, isDesktop } = useBreakpoint();
  return isDesktop ? 40 : isTablet ? spacing.x2 : spacing.lg;
}

export interface PageProps {
  children: ReactNode;
  /** Rendered above the scroll area, aligned to the content column (e.g. ScreenHeader). */
  header?: ReactNode;
  /** Pinned below the scroll area, aligned to the content column (e.g. wizard buttons). */
  footer?: ReactNode;
  /** Content max width: narrow 640 (forms), default 1040, wide 1240 (tables, brackets). */
  width?: keyof typeof contentWidth;
  /** Native pull-to-refresh. On web, pass the same handler to ScreenHeader's `onRefresh`. */
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollRef?: Ref<ScrollView>;
  /** Safe-area edges. Tab screens use ["top"] (the tab bar owns the bottom). */
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Set false for screens that manage their own scrolling (lists, pagers). */
  scroll?: boolean;
  keyboardShouldPersistTaps?: "always" | "handled" | "never";
}

export function Page({
  children,
  header,
  footer,
  width = "default",
  refreshing,
  onRefresh,
  scrollRef,
  edges = ["top", "bottom"],
  contentStyle,
  scroll = true,
  keyboardShouldPersistTaps = "handled",
}: PageProps) {
  const gutter = useGutter();
  const { isDesktop } = useBreakpoint();
  const column: ViewStyle = {
    width: "100%",
    maxWidth: contentWidth[width] + gutter * 2,
    alignSelf: "center",
    paddingHorizontal: gutter,
  };
  const isWeb = Platform.OS === "web";

  return (
    <PageContext.Provider value={{ gutter }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={edges}>
        {/* Soft page-enter fade: web stack pushes have no transition of their own. Opacity
            only, on the whole scaffold, so it can't disturb content layout or sticky. */}
        <Reveal from="fade" duration={motion.base} style={{ flex: 1 }}>
          {header ? <View style={column}>{header}</View> : null}
          {scroll ? (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={[
                column,
                {
                  paddingTop: header ? spacing.xs : isDesktop ? spacing.x2 : spacing.sm,
                  paddingBottom: isDesktop ? spacing.x4 : spacing.x3,
                },
                contentStyle,
              ]}
              // Desktop users need the scrollbar as a cue; phones don't.
              showsVerticalScrollIndicator={isWeb && isDesktop}
              keyboardShouldPersistTaps={keyboardShouldPersistTaps}
              refreshControl={
                onRefresh && !isWeb ? (
                  <RefreshControl
                    refreshing={!!refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.accent}
                  />
                ) : undefined
              }
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
          )}
          {footer ? <View style={column}>{footer}</View> : null}
        </Reveal>
      </SafeAreaView>
    </PageContext.Provider>
  );
}

type BreakpointName = "tablet" | "desktop" | "wide";

export interface ColumnsProps {
  children: ReactNode;
  /** Breakpoint at which columns sit side by side (stacked below it). */
  at?: BreakpointName;
  /** Flex weight per column, e.g. [3, 2]. Defaults to equal widths. */
  ratio?: number[];
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Side-by-side columns from `at` upward. Children are the columns (null children are
 * skipped). Column wrappers stretch to the row's height (content still top-aligns inside
 * them), which is what gives a `sticky` child room to pin while its neighbour scrolls.
 */
export function Columns({
  children,
  at = "desktop",
  ratio,
  gap = spacing.x2,
  style,
}: ColumnsProps) {
  const bp = useBreakpoint();
  const split = at === "tablet" ? bp.isTablet : at === "desktop" ? bp.isDesktop : bp.isWide;
  const cols = Children.toArray(children);
  if (!split) {
    return <View style={[{ gap }, style]}>{cols}</View>;
  }
  return (
    <View style={[{ flexDirection: "row", alignItems: "stretch", gap }, style]}>
      {cols.map((child, i) => (
        <View key={i} style={{ flex: ratio?.[i] ?? 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** Web: pin a column's content while the page scrolls (inside `Columns`). No-op on native. */
export const sticky = webStyle({ position: "sticky", top: spacing.lg });

export interface GridProps {
  children: ReactNode;
  /** Minimum tile width; the grid fits as many columns as this allows. */
  min?: number;
  /** Cap on columns (e.g. 2 for stat pairs even on huge screens). */
  maxColumns?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Responsive tile grid: measures its own width and fits `floor(w / min)` columns. */
export function Grid({ children, min = 280, maxColumns, gap = spacing.md, style }: GridProps) {
  const [width, setWidth] = useState(0);
  const items = Children.toArray(children);
  const fit = width > 0 ? Math.floor((width + gap) / (min + gap)) : 1;
  const columns = Math.max(1, Math.min(fit, maxColumns ?? fit, items.length || 1));
  // Floor to 0.01px so sub-pixel rounding can never push the last tile onto a new row.
  const tile =
    width > 0 ? Math.floor(((width - gap * (columns - 1)) / columns) * 100) / 100 : undefined;
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", flexWrap: "wrap", gap }, style]}
    >
      {items.map((child, i) => (
        // Children.toArray gives each child a stable key, so removing one tile doesn't
        // remount the tiles after it.
        <View
          key={isValidElement(child) && child.key != null ? child.key : i}
          style={tile !== undefined ? { width: tile } : { width: "100%" }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
