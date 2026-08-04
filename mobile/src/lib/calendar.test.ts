import test from "node:test";
import assert from "node:assert/strict";
import {
  MINUTE_STEP,
  addDays,
  addMonths,
  daysBetween,
  durationLabel,
  formatDate,
  formatDateTime,
  formatTime,
  isSameDay,
  isSameMonth,
  monthGrid,
  monthLabel,
  pad2,
  startOfDay,
  startOfMonth,
  withDay,
  withTime,
} from "./calendar";

test("startOfDay and startOfMonth strip the smaller units", () => {
  const date = new Date(2026, 7, 17, 14, 32, 9, 500);
  assert.deepEqual(startOfDay(date), new Date(2026, 7, 17));
  assert.deepEqual(startOfMonth(date), new Date(2026, 7, 1));
});

test("addDays crosses month and year boundaries", () => {
  assert.deepEqual(addDays(new Date(2026, 0, 30), 3), new Date(2026, 1, 2));
  assert.deepEqual(addDays(new Date(2026, 11, 31, 9, 0), 1), new Date(2027, 0, 1, 9, 0));
  assert.deepEqual(addDays(new Date(2026, 2, 1), -1), new Date(2026, 1, 28));
});

test("addMonths clamps the day to the target month and keeps the time", () => {
  assert.deepEqual(addMonths(new Date(2026, 0, 31, 9, 30), 1), new Date(2026, 1, 28, 9, 30));
  assert.deepEqual(addMonths(new Date(2028, 0, 31), 1), new Date(2028, 1, 29)); // leap year
  assert.deepEqual(addMonths(new Date(2026, 0, 15, 21, 0), -1), new Date(2025, 11, 15, 21, 0));
});

test("monthGrid returns six Monday-first weeks around the month", () => {
  // 1 Aug 2026 is a Saturday, so the grid opens on Monday 27 July.
  const grid = monthGrid(new Date(2026, 7, 12));
  assert.equal(grid.length, 42);
  assert.deepEqual(grid[0], new Date(2026, 6, 27));
  assert.equal(grid[0].getDay(), 1);
  assert.deepEqual(grid[41], new Date(2026, 8, 6));
  assert.ok(grid.some((day) => isSameDay(day, new Date(2026, 7, 1))));
  assert.ok(grid.some((day) => isSameDay(day, new Date(2026, 7, 31))));
});

test("monthGrid starts on the 1st when the month opens on a Monday", () => {
  // 1 Jun 2026 is a Monday — no leading days from May.
  const grid = monthGrid(new Date(2026, 5, 20));
  assert.deepEqual(grid[0], new Date(2026, 5, 1));
});

test("isSameDay and isSameMonth compare calendar fields, not timestamps", () => {
  assert.ok(isSameDay(new Date(2026, 7, 3, 0, 1), new Date(2026, 7, 3, 23, 59)));
  assert.ok(!isSameDay(new Date(2026, 7, 3), new Date(2026, 7, 4)));
  assert.ok(!isSameDay(new Date(2025, 7, 3), new Date(2026, 7, 3)));
  assert.ok(isSameMonth(new Date(2026, 7, 1), new Date(2026, 7, 31)));
  assert.ok(!isSameMonth(new Date(2026, 7, 31), new Date(2026, 8, 1)));
});

test("withTime and withDay recombine a day and a clock", () => {
  assert.deepEqual(withTime(new Date(2026, 7, 3, 18, 45), 9, 5), new Date(2026, 7, 3, 9, 5));
  const selection = new Date(2026, 7, 3, 9, 5);
  assert.deepEqual(withDay(selection, new Date(2026, 8, 20, 23, 59)), new Date(2026, 8, 20, 9, 5));
});

test("labels are stable across platforms", () => {
  const date = new Date(2026, 7, 3, 9, 5);
  assert.equal(pad2(5), "05");
  assert.equal(pad2(15), "15");
  assert.equal(monthLabel(date), "August 2026");
  assert.equal(formatDate(date), "Mon 3 Aug 2026");
  assert.equal(formatTime(date), "09:05");
  assert.equal(formatDateTime(date), "Mon 3 Aug 2026 · 09:05");
  assert.equal(formatTime(new Date(2026, 7, 3, 0, 0)), "00:00");
});

test("daysBetween ignores the time of day", () => {
  assert.equal(daysBetween(new Date(2026, 7, 3, 23, 0), new Date(2026, 7, 4, 1, 0)), 1);
  assert.equal(daysBetween(new Date(2026, 7, 3, 9, 0), new Date(2026, 7, 3, 21, 0)), 0);
  assert.equal(daysBetween(new Date(2026, 7, 10), new Date(2026, 7, 3)), -7);
});

test("durationLabel summarises a season's length", () => {
  assert.equal(durationLabel(new Date(2026, 7, 3), new Date(2026, 7, 3, 21, 0)), "same day");
  assert.equal(durationLabel(new Date(2026, 7, 3), new Date(2026, 7, 4)), "1 day");
  assert.equal(durationLabel(new Date(2026, 7, 3), new Date(2026, 7, 10)), "7 days");
  assert.equal(durationLabel(new Date(2026, 7, 3), new Date(2026, 10, 1)), "13 weeks · 90 days");
  assert.equal(durationLabel(new Date(2026, 7, 10), new Date(2026, 7, 3)), "ends before it starts");
});

test("the minute step divides the hour evenly", () => {
  assert.equal(60 % MINUTE_STEP, 0);
});
