/** Date/format helpers ported from the prototype. */

/** "2026-04-12" → "12 Apr". */
export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Whole days remaining until the end of `iso` (inclusive), from `now`. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const end = new Date(iso + "T23:59:59").getTime();
  return Math.max(0, Math.ceil((end - now.getTime()) / 86400000));
}
