const test = require("node:test");
const assert = require("node:assert/strict");
const { seasonJoinRejection } = require("../lib/membershipRules.js");

test("an active, non-finalized season can be joined", () => {
  assert.equal(seasonJoinRejection({ active: true, finalized: false }), null);
  assert.equal(seasonJoinRejection({ active: true }), null);
});

test("an inactive season is rejected", () => {
  assert.equal(seasonJoinRejection({ active: false }), "inactive");
  assert.equal(seasonJoinRejection({}), "inactive");
});

test("a finalized (but active) season is rejected", () => {
  assert.equal(seasonJoinRejection({ active: true, finalized: true }), "finalized");
});

test("inactive takes precedence over finalized", () => {
  assert.equal(seasonJoinRejection({ active: false, finalized: true }), "inactive");
});
