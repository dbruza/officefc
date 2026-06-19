const test = require("node:test");
const assert = require("node:assert/strict");
const { responderRejection } = require("../lib/matchRules.js");

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
