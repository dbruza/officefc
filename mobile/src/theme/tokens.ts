/**
 * OfficeFC design tokens — ported 1:1 from the prototype's CSS custom properties
 * (prototype/officefc/OfficeFC.html `:root`). Single source of truth for the RN theme.
 */

export const colors = {
  bg: "#070a0e",
  surface: "#10141b",
  surface2: "#1a212b",
  line: "rgba(255,255,255,0.08)",

  text: "#eef2f6",
  textDim: "#8b95a4",
  textFaint: "#4c5563",

  accent: "#00ff87",
  /** Foreground used on top of the accent fill (near-black). */
  onAccent: "#06080c",

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

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  x2: 24,
  x3: 32,
} as const;

export const radius = {
  sm: 8,
  md: 13,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;
