const test = require("node:test");
const assert = require("node:assert/strict");
const {
  responderRejection,
  canAutoConfirm,
  matchCreatedMillis,
  opponentOf,
} = require("../lib/matchRules.js");

// alice submitted a pending match between alice and bob.
const pending = { aId: "alice", bId: "bob", submittedBy: "alice", status: "pending_confirmation" };

test("the named opponent may respond to a pending match", () => {
  assert.equal(responderRejection(pending, "bob"), null);
});

test("the submitter may not confirm their own result", () => {
  assert.equal(responderRejection(pending, "alice"), "not_opponent");
});

test("a non-participant may not respond", () => {
  assert.equal(responderRejection(pending, "carol"), "not_opponent");
});

test("a settled match can no longer be responded to", () => {
  assert.equal(responderRejection({ ...pending, status: "confirmed" }, "bob"), "not_pending");
  assert.equal(responderRejection({ ...pending, status: "disputed" }, "bob"), "not_pending");
});

test("the opponent check takes precedence over status for a non-participant", () => {
  // A non-participant facing a settled match is rejected as not_opponent, not not_pending.
  assert.equal(responderRejection({ ...pending, status: "confirmed" }, "carol"), "not_opponent");
});

test("opponentOf names the participant who didn't submit", () => {
  assert.equal(opponentOf(pending), "bob");
  assert.equal(opponentOf({ ...pending, submittedBy: "bob" }), "alice");
  assert.equal(opponentOf({ aId: "alice", submittedBy: "alice" }), null);
  assert.equal(opponentOf({ aId: "alice", bId: 7, submittedBy: "alice" }), null);
});

// --- canAutoConfirm: eligibility for the after-the-window automated confirmation ---

// A 24-hour window ending "now" at t=1_000_000_000, with a 72h abandonment floor.
const NOW = 1_000_000_000;
const HOUR = 60 * 60 * 1000;
const CUTOFF = NOW - 24 * HOUR; // created at or before this → window lapsed
const FLOOR = NOW - 72 * HOUR; // created before this → abandoned, leave for an admin

const stampedAt = (ms) => ({ status: "pending_confirmation", createdAt: { toMillis: () => ms } });

test("canAutoConfirm: a pending match past its window is eligible", () => {
  assert.equal(canAutoConfirm(stampedAt(CUTOFF - 1), CUTOFF, FLOOR), true);
  // Exactly at the cutoff counts as lapsed.
  assert.equal(canAutoConfirm(stampedAt(CUTOFF), CUTOFF, FLOOR), true);
});

test("canAutoConfirm: a match still inside its dispute window is not eligible", () => {
  assert.equal(canAutoConfirm(stampedAt(CUTOFF + 1), CUTOFF, FLOOR), false);
  assert.equal(canAutoConfirm(stampedAt(NOW), CUTOFF, FLOOR), false);
});

test("canAutoConfirm: a settled match is never eligible", () => {
  const past = stampedAt(CUTOFF - HOUR);
  assert.equal(canAutoConfirm({ ...past, status: "confirmed" }, CUTOFF, FLOOR), false);
  assert.equal(canAutoConfirm({ ...past, status: "disputed" }, CUTOFF, FLOOR), false);
});

// A finals result advances the bracket, and that advance can't be replayed once the match
// leaves `pending_confirmation` — so a knockout always waits for a human.
test("canAutoConfirm: a finals match is never auto-confirmed, however old", () => {
  const past = stampedAt(CUTOFF - HOUR);
  assert.equal(canAutoConfirm({ ...past, finals: true }, CUTOFF, FLOOR), false);
  // Without the finals flag the very same match is eligible — the flag is what excludes it.
  assert.equal(canAutoConfirm(past, CUTOFF, FLOOR), true);
  // Only an explicit `true` excludes; a regular match may carry finals: false or omit it.
  assert.equal(canAutoConfirm({ ...past, finals: false }, CUTOFF, FLOOR), true);
});

test("canAutoConfirm: a long-abandoned match is left for an admin", () => {
  assert.equal(canAutoConfirm(stampedAt(FLOOR - 1), CUTOFF, FLOOR), false);
  // Without a floor the same match is eligible — the floor is what excludes it.
  assert.equal(canAutoConfirm(stampedAt(FLOOR - 1), CUTOFF), true);
});

// Regression: an un-ageable stamp must never be treated as infinitely old. Reading it as 0
// would put it before every cutoff and confirm it instantly, with no dispute window at all.
test("canAutoConfirm: no ageable creation stamp is skipped (never confirm sight-unseen)", () => {
  assert.equal(canAutoConfirm({ status: "pending_confirmation" }, CUTOFF, FLOOR), false);
  assert.equal(canAutoConfirm({ status: "pending_confirmation", createdAt: null }, CUTOFF), false);
  assert.equal(
    canAutoConfirm({ status: "pending_confirmation", createdAt: "not-a-date" }, CUTOFF),
    false,
  );
  // An object with a non-callable toMillis must not throw or pass.
  assert.equal(
    canAutoConfirm({ status: "pending_confirmation", createdAt: { toMillis: 5 } }, CUTOFF),
    false,
  );
});

test("canAutoConfirm: falls back to `date` when createdAt is unreadable, and ages it the same", () => {
  const iso = new Date(CUTOFF - HOUR).toISOString();
  assert.equal(canAutoConfirm({ status: "pending_confirmation", date: iso }, CUTOFF, FLOOR), true);
  // The same fallback still respects the window.
  const recent = new Date(NOW).toISOString();
  assert.equal(canAutoConfirm({ status: "pending_confirmation", date: recent }, CUTOFF), false);
});

test("matchCreatedMillis: resolves Timestamps and strings, null when unreadable", () => {
  assert.equal(matchCreatedMillis({ createdAt: { toMillis: () => 42 } }), 42);
  assert.equal(
    matchCreatedMillis({ date: "2026-08-01T00:00:00Z" }),
    Date.parse("2026-08-01T00:00:00Z"),
  );
  // createdAt wins when both are readable.
  assert.equal(matchCreatedMillis({ createdAt: { toMillis: () => 42 }, date: "2026-08-01" }), 42);
  assert.equal(matchCreatedMillis({}), null);
  // Epoch 0 is a real value, distinct from "unreadable".
  assert.equal(matchCreatedMillis({ createdAt: { toMillis: () => 0 } }), 0);
});
