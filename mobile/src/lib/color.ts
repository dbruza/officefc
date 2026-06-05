/**
 * Colour helpers — RN has no CSS `color-mix()`/`shade()`, so the prototype's colour
 * math is reproduced here in pure TS.
 */

function clamp(n: number, lo = 0, hi = 255): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let c = hex.replace("#", "").trim();
  if (c.length === 3) {
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const n = parseInt(c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1)}`;
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour, like the prototype's `shade`. */
export function shade(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex(r + amt, g + amt, b + amt);
}

/** Opaque blend of two hex colours; `pct` is how much of `top` to mix over `base` (0–100). */
export function mix(base: string, top: string, pct: number): string {
  const a = parseHex(base);
  const b = parseHex(top);
  const t = clamp(pct, 0, 100) / 100;
  return toHex(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
  );
}

/** Hex colour with an alpha channel, as an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}
