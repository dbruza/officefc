/**
 * OfficeFC design tokens — ported 1:1 from the prototype's CSS custom properties
 * (prototype/officefc/OfficeFC.html `:root`). Single source of truth for the RN theme.
 */

export const colors = {
  bg: "#070a0e",
  surface: "#10141b",
  surface2: "#1a212b",
  /** Hovered / raised surface (one step above surface2). */
  surface3: "#232b37",
  line: "rgba(255,255,255,0.08)",
  /** Stronger hairline for hovered / focused edges. */
  lineStrong: "rgba(255,255,255,0.16)",

  text: "#eef2f6",
  textDim: "#8b95a4",
  /**
   * Tertiary text (timestamps, placeholders, meta). Lifted from #4c5563 (2.6:1) to clear
   * ~4:1 on bg while staying a clear step below textDim.
   */
  textFaint: "#6a7381",
  /** Decorative-only faint ink (separators, disabled glyphs) — never for readable copy. */
  textDisabled: "#4c5563",

  accent: "#00ff87",
  /** Foreground used on top of the accent fill (near-black). */
  onAccent: "#06080c",
  /** Champion gold (trophy / #1 medal). */
  gold: "#ffd24a",
  /** Runner-up / third-place medals. */
  silver: "#cdd6e0",
  bronze: "#e0935b",

  win: "#22e06a",
  draw: "#9aa6b4",
  loss: "#ff4d6d",
} as const;

/** Result → colour, matching the prototype's W/D/L palette. */
export const resultColor = {
  W: colors.win,
  D: colors.draw,
  L: colors.loss,
} as const;

export const fonts = {
  /** Display / headings. */
  head: "Archivo_700Bold",
  /** Body. */
  body: "Archivo_400Regular",
  bodyMedium: "Archivo_500Medium",
  /** Tabular numerics (ELO, scores). */
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

/**
 * Type scale. Prefer these over ad-hoc sizes in new code: `eyebrow` is the uppercase
 * tracked label, `caption` the dim meta line, `display` the hero ELO number.
 */
export const typeScale = {
  eyebrow: 10.5,
  caption: 12,
  body: 14,
  bodyLg: 15.5,
  title: 17,
  heading: 22,
  headingLg: 28,
  display: 40,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  x2: 24,
  x3: 32,
  x4: 48,
} as const;

export const radius = {
  sm: 8,
  md: 13,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

/**
 * Viewport widths where the layout changes. Below `tablet` is the phone layout (bottom
 * tabs, single column); at `desktop` the side rail replaces the tab bar and screens can
 * split into columns.
 */
export const breakpoints = {
  tablet: 768,
  desktop: 1024,
  wide: 1320,
} as const;

/** Max content widths for the three page shapes (see `Page`). */
export const contentWidth = {
  narrow: 640,
  default: 1040,
  wide: 1240,
} as const;

/** Durations (ms) and easings shared by every transition so motion feels like one system. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 380,
  /** Stagger between list items on entrance. Keep small — lists should settle fast. */
  stagger: 45,
  /** Cap on total stagger so long lists don't trickle in. */
  staggerMax: 360,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Web box-shadows (native ignores these; surfaces rely on borders there). */
export const elevation = {
  hover: "0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04)",
  overlay: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
  glow: "0 0 0 1px rgba(0,255,135,0.35), 0 8px 28px rgba(0,255,135,0.18)",
  focus: "0 0 0 2px #070a0e, 0 0 0 4px rgba(0,255,135,0.75)",
} as const;
