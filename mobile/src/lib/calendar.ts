/**
 * Date maths and labels for the in-app date/time picker. Pure functions with no React
 * Native imports, so they stay unit-testable. Labels are hand-built rather than taken
 * from `toLocaleDateString` so the wording is identical on every platform and locale.
 */

/** Grid columns, Monday-first (the league's week). */
export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** Minute granularity the picker offers — a season boundary never needs finer. */
export const MINUTE_STEP = 5;

/** Six weeks always cover a month, so the grid never changes height mid-navigation. */
const GRID_DAYS = 42;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

/** Month arithmetic that clamps the day: 31 Jan + 1 month is 28 Feb, not 3 Mar. */
export function addMonths(date: Date, delta: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), daysInTarget));
  target.setHours(date.getHours(), date.getMinutes(), 0, 0);
  return target;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Keep `date`'s calendar day, take the clock from the given hours/minutes. */
export function withTime(date: Date, hours: number, minutes: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

/** Move a selection onto another day, keeping the time already chosen. */
export function withDay(time: Date, day: Date): Date {
  return withTime(day, time.getHours(), time.getMinutes());
}

/**
 * The 42 cells covering `month`, starting on the Monday on or before the 1st. Leading and
 * trailing cells belong to the neighbouring months — callers dim them via `isSameMonth`.
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // getDay() is Sunday-first (0–6); shift so Monday is column 0.
  const leading = (first.getDay() + 6) % 7;
  const start = addDays(first, -leading);
  return Array.from({ length: GRID_DAYS }, (_, index) => addDays(start, index));
}

/** "August 2026" — the picker's month header. */
export function monthLabel(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "09:05" */
export function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "Mon 3 Aug 2026" */
export function formatDate(date: Date): string {
  return `${SHORT_DAYS[date.getDay()]} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Mon 3 Aug 2026 · 09:05" — what the closed field shows. */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} · ${formatTime(date)}`;
}

/** Whole days between two dates, ignoring the time of day. Negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86400000;
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** "12 weeks · 84 days" style summary for a season's length. */
export function durationLabel(from: Date, to: Date): string {
  const days = daysBetween(from, to);
  if (days < 0) return "ends before it starts";
  if (days === 0) return "same day";
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.round(days / 7);
  return `${weeks} weeks · ${days} days`;
}
