const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");
const { changedFields } = require("../lib/modelWriter");
test("timestamps alone never cause a historical match rewrite", () => {
  assert.equal(
    changedFields(
      { aDelta: 12, recalculatedAt: Timestamp.now() },
      { aDelta: 12, recalculatedAt: FieldValue.serverTimestamp() },
    ),
    false,
  );
  assert.equal(changedFields({ aDelta: 12 }, { aDelta: 13 }), true);
});
test("nested history values are compared by value and deleted fields cannot be mistaken for unchanged values", () => {
  const points = [{ date: Timestamp.fromMillis(100), rating: 1500 }];
  assert.equal(
    changedFields({ points }, { points: [{ date: Timestamp.fromMillis(100), rating: 1500 }] }),
    false,
  );
  assert.equal(changedFields({ points }, { points: [] }), true);
  assert.equal(changedFields(undefined, { points: [] }), true);
});
