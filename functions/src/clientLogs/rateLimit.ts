/** Pure sliding-window check. Returns whether allowed + the pruned timestamps to store. */
export function checkRateLimit(
  recent: number[],
  now: number,
  windowMs: number,
  max: number,
): { allowed: boolean; next: number[] } {
  const pruned = recent.filter((t) => now - t < windowMs);
  if (pruned.length >= max) return { allowed: false, next: pruned };
  return { allowed: true, next: [...pruned, now] };
}
