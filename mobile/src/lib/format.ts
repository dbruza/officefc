/** Format helpers ported from the prototype. */

/** "Alex Morgan" → "Alex". */
export function firstName(name: string): string {
  return name.split(" ")[0];
}

/** "1 meeting", "3 meetings" — count with a naive-pluralized noun. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

/** Format an xG value for display: two decimals max, trailing zeros trimmed ("1.85", "1"). */
export function fmtXg(xg: number | null | undefined): string {
  if (xg == null) return "-";
  return String(parseFloat(xg.toFixed(2)));
}
