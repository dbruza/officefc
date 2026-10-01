/**
 * Viewport-driven layout flags. On web the window is the browser viewport, so these flip
 * live as the window resizes; on native they're effectively constant per device.
 */
import { Platform, useWindowDimensions } from "react-native";
import { breakpoints } from "@/theme";

export interface Breakpoint {
  width: number;
  height: number;
  /** < tablet: phone layout — bottom tabs, one column. */
  isPhone: boolean;
  /** ≥ tablet: roomier gutters, 2-up grids. */
  isTablet: boolean;
  /** ≥ desktop: side rail replaces the tab bar; screens may split into columns. */
  isDesktop: boolean;
  /** ≥ wide: three-column grids where it helps. */
  isWide: boolean;
  /** Web build (hover, keyboard, cursor affordances apply). */
  isWeb: boolean;
}

export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < breakpoints.tablet,
    isTablet: width >= breakpoints.tablet,
    isDesktop: width >= breakpoints.desktop,
    isWide: width >= breakpoints.wide,
    isWeb: Platform.OS === "web",
  };
}

/** Pick a value per breakpoint, falling back to the nearest smaller one. */
export function useResponsive<T>(values: { phone: T; tablet?: T; desktop?: T; wide?: T }): T {
  const bp = useBreakpoint();
  if (bp.isWide && values.wide !== undefined) return values.wide;
  if (bp.isDesktop && values.desktop !== undefined) return values.desktop;
  if (bp.isTablet && values.tablet !== undefined) return values.tablet;
  return values.phone;
}
