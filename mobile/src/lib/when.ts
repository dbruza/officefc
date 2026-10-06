/** Short relative times for match meta ("2h ago", "yesterday", "12 Sep"). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(date: Date | number | null | undefined, now = Date.now()): string {
  if (date == null) return "just now";
  const t = typeof date === "number" ? date : date.getTime();
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Today 14:05", "Yesterday 09:30", "Tue 18:10", or "12 Sep 2026" for older dates. */
export function playedAt(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "Just now";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday) return `Today ${time}`;
  if (t >= startOfToday - DAY) return `Yesterday ${time}`;
  if (t >= startOfToday - 6 * DAY) {
    return `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A deadline: "today 14:05", "tomorrow 09:30", or "Tue 18:10" further out (or overdue). */
export function dueAt(date: Date, now = new Date()): string {
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday && t < startOfToday + DAY) return `today ${time}`;
  if (t >= startOfToday + DAY && t < startOfToday + 2 * DAY) return `tomorrow ${time}`;
  return `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
}
