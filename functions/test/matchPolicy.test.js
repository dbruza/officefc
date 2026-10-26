const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTO_CONFIRM_HOURS,
  AUTO_CONFIRM_MAX_AGE_HOURS,
  HOUR_MS,
  MAX_PENDING_PER_OPPONENT,
  MAX_PENDING_PER_SUBMITTER,
  PENDING_LIMIT_MESSAGES,
  REMINDER_HOURS,
  autoConfirmDueMillis,
  pendingLimitBreach,
  reminderDueMillis,
} = require("../lib/models/matchPolicy.js");

test("the opponent gets a full day, with a reminder before it closes", () => {
  assert.equal(AUTO_CONFIRM_HOURS, 24);
  assert.ok(REMINDER_HOURS > 0 && REMINDER_HOURS < AUTO_CONFIRM_HOURS);
  // The abandonment floor has to leave room to confirm after the window closes.
  assert.ok(AUTO_CONFIRM_MAX_AGE_HOURS > AUTO_CONFIRM_HOURS);
  assert.equal(autoConfirmDueMillis(1000), 1000 + 24 * HOUR_MS);
  assert.equal(reminderDueMillis(1000), 1000 + REMINDER_HOURS * HOUR_MS);
});

/** `count` pending results against `opponentId`, oldest first, ids p0..p{count-1}. */
function pending(count, opponentId = "bob", offset = 0) {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i + offset}`, opponentId }));
}

test("a submission under both limits is accepted", () => {
  assert.equal(pendingLimitBreach([], { opponentId: "bob" }), null);
  assert.equal(
    pendingLimitBreach(pending(MAX_PENDING_PER_OPPONENT - 1), { opponentId: "bob" }),
    null,
  );
});

test("a new submission past the per-opponent limit is refused", () => {
  assert.equal(
    pendingLimitBreach(pending(MAX_PENDING_PER_OPPONENT), { opponentId: "bob" }),
    "opponent",
  );
  // The limit is per opponent: the same backlog doesn't stop a result against someone else.
  assert.equal(
    pendingLimitBreach(pending(MAX_PENDING_PER_OPPONENT), { opponentId: "carol" }),
    null,
  );
});

test("a new submission past the per-submitter limit is refused, whoever it's against", () => {
  const spread = Array.from({ length: MAX_PENDING_PER_SUBMITTER }, (_, i) => ({
    id: `p${i}`,
    opponentId: `opponent${i}`,
  }));
  assert.equal(pendingLimitBreach(spread, { opponentId: "someone-new" }), "submitter");
});

test("a stored submission is judged by its place: the oldest keep theirs", () => {
  const rows = pending(MAX_PENDING_PER_OPPONENT + 2);
  // The first eight against bob fit; the ninth and tenth are the excess.
  assert.equal(pendingLimitBreach(rows, { id: "p0", opponentId: "bob" }), null);
  assert.equal(
    pendingLimitBreach(rows, { id: `p${MAX_PENDING_PER_OPPONENT - 1}`, opponentId: "bob" }),
    null,
  );
  assert.equal(
    pendingLimitBreach(rows, { id: `p${MAX_PENDING_PER_OPPONENT}`, opponentId: "bob" }),
    "opponent",
  );
  // Results against other opponents ahead of it don't count toward the per-opponent limit.
  const mixed = [...pending(5, "carol"), ...pending(MAX_PENDING_PER_OPPONENT, "bob", 5)];
  assert.equal(pendingLimitBreach(mixed, { id: "p12", opponentId: "bob" }), null);
});

test("a stored submission outside the first page has too many ahead of it", () => {
  const full = Array.from({ length: MAX_PENDING_PER_SUBMITTER }, (_, i) => ({
    id: `p${i}`,
    opponentId: `opponent${i}`,
  }));
  assert.equal(pendingLimitBreach(full, { id: "later", opponentId: "x" }), "submitter");
  // ...but within the page it fits, even when the page is full.
  assert.equal(pendingLimitBreach(full, { id: "p19", opponentId: "opponent19" }), null);
});

test("every limit has a message that names it", () => {
  assert.match(
    PENDING_LIMIT_MESSAGES.submitter,
    new RegExp(`${MAX_PENDING_PER_SUBMITTER} results`),
  );
  assert.match(PENDING_LIMIT_MESSAGES.opponent, new RegExp(`${MAX_PENDING_PER_OPPONENT} results`));
});
