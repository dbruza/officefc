import test from "node:test";
import assert from "node:assert/strict";
import { dueAt } from "./when";

// Local-time constructors so the expectations hold in any timezone.
const now = new Date(2026, 9, 6, 9, 0); // Tue 6 Oct 2026, 09:00

test("dueAt names today and tomorrow, and falls back to the weekday", () => {
  assert.equal(dueAt(new Date(2026, 9, 6, 14, 5), now), "today 14:05");
  assert.equal(dueAt(new Date(2026, 9, 7, 9, 30), now), "tomorrow 09:30");
  assert.match(dueAt(new Date(2026, 9, 9, 18, 10), now), /^Fri 18:10$/);
  // Overdue by more than a day reads as a weekday, never as "today".
  assert.match(dueAt(new Date(2026, 9, 4, 8, 0), now), /^Sun 08:00$/);
});
