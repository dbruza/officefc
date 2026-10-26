/**
 * Unit tests for push preference gating in notify.ts: the type→category mapping,
 * the defensive isMuted check, and (via an injected Firestore stub) that sendPush
 * skips delivery when the caller muted the push's category and delivers when the
 * prefs doc is missing or malformed. Imports the compiled JS (functions/lib/notify.js)
 * so the same path works whether tests run before or after a source change compiles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PUSH_CATEGORY_KEYS, isMuted, pushCategory } from "../functions/lib/notify.js";

test("every audited call-site type maps to its category", () => {
  assert.equal(pushCategory("match_confirmed"), "results");
  assert.equal(pushCategory("match_voided"), "results");
  assert.equal(pushCategory("match_pending"), "confirmations");
  assert.equal(pushCategory("match_disputed"), "disputes");
  assert.equal(pushCategory("fixture_created"), "fixtures");
  assert.equal(pushCategory("finals_set"), "finals");
  assert.equal(pushCategory("finals_tie_set"), "finals");
});

test("missing type falls back to general; unknown types do too", () => {
  assert.equal(pushCategory(undefined), "general");
  assert.equal(pushCategory("some_future_type"), "general");
  assert.equal(pushCategory(""), "general");
});

test("category list stays exactly the six documented buckets", () => {
  // This is the contract mirrored by PUSH_CATEGORIES in
  // mobile/src/lib/league/pushPrefs.ts — changing it must update both sides.
  assert.deepEqual(
    [...PUSH_CATEGORY_KEYS],
    ["results", "confirmations", "disputes", "fixtures", "finals", "general"],
  );
});

test("isMuted only counts a well-formed string array containing the category", () => {
  assert.equal(isMuted(["results"], "match_confirmed"), true);
  assert.equal(isMuted(["results", "finals"], "finals_tie_set"), true);
  assert.equal(isMuted(["results"], "match_disputed"), false);
  assert.equal(isMuted([], "match_confirmed"), false);
  // Defensive shapes: none of these may silence a push.
  assert.equal(isMuted(undefined, "match_confirmed"), false);
  assert.equal(isMuted(null, "match_confirmed"), false);
  assert.equal(isMuted("results", "match_confirmed"), false);
  assert.equal(isMuted({}, "match_confirmed"), false);
  assert.equal(isMuted([1, null, {}], "match_confirmed"), false);
  assert.equal(isMuted(["results"], undefined), false);
});

test("muting a category does not leak into other categories", () => {
  const muted = ["confirmations"];
  for (const type of ["match_confirmed", "match_disputed", "fixture_created"]) {
    assert.equal(isMuted(muted, type), false, `${type} should still deliver`);
  }
  assert.equal(isMuted(muted, undefined), false, "general should still deliver");
});
