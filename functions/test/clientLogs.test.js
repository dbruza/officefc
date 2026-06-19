const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeLogBatch } = require("../lib/clientLogs/sanitize.js");
const { checkRateLimit } = require("../lib/clientLogs/rateLimit.js");

test("sanitizeLogBatch caps batch size and counts the overflow as rejected", () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({
    level: "warn",
    event: "e" + i,
    clientTs: 1000,
  }));
  const r = sanitizeLogBatch({ entries }, { now: 1000, maxBatch: 20 });
  assert.equal(r.accepted.length, 20);
  assert.equal(r.rejected, 5);
});

test("sanitizeLogBatch clamps unknown severity to info and requires an event", () => {
  const r = sanitizeLogBatch(
    { entries: [{ level: "catastrophe", event: "x", clientTs: 1000 }, { level: "warn" }] },
    { now: 1000 },
  );
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].level, "info");
  assert.equal(r.rejected, 1);
});

test("sanitizeLogBatch redacts sensitive keys and drops non-scalars", () => {
  const r = sanitizeLogBatch(
    {
      entries: [
        {
          level: "error",
          event: "boom",
          context: { authToken: "abc", nested: { a: 1 }, n: 2 },
          clientTs: 1000,
        },
      ],
    },
    { now: 1000 },
  );
  assert.deepEqual(r.accepted[0].context, {
    authToken: "[redacted]",
    nested: "[unsupported]",
    n: 2,
  });
});

test("sanitizeLogBatch nulls implausible client timestamps", () => {
  const r = sanitizeLogBatch(
    { entries: [{ level: "warn", event: "e", clientTs: 0 }] },
    { now: 5 * 24 * 60 * 60 * 1000 },
  );
  assert.equal(r.accepted[0].clientTs, null);
});

test("sanitizeLogBatch rejects when there is no entries array", () => {
  const r = sanitizeLogBatch({}, { now: 1000 });
  assert.deepEqual(r, { accepted: [], rejected: 0, reason: "no-entries" });
});

test("checkRateLimit allows under the cap, blocks at it, and prunes old hits", () => {
  const under = checkRateLimit([1, 2, 3], 1000, 60000, 5);
  assert.equal(under.allowed, true);
  assert.deepEqual(under.next, [1, 2, 3, 1000]);

  const pruned = checkRateLimit([1, 2], 100000, 60000, 5); // both outside the window
  assert.deepEqual(pruned.next, [100000]);

  const full = checkRateLimit([10, 20, 30, 40, 50], 60, 60000, 5);
  assert.equal(full.allowed, false);
});
