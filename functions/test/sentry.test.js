const test = require("node:test");
const assert = require("node:assert/strict");
// Force the disabled-SDK state before the module-load Sentry.init runs — an ambient
// SENTRY_DSN (e.g. a sourced functions/.env) must never make these tests hit the network.
// Captures are no-ops but every code path in our wrappers still executes.
delete process.env.SENTRY_DSN;
process.env.FUNCTIONS_EMULATOR = "true";
const { captureServerFault, instrumentBackground } = require("../lib/sentry.js");

test("captureServerFault resolves with full context (never throws contract)", async () => {
  await captureServerFault(new Error("boom"), { fn: "demoFn", uid: "u1", durationMs: 42 });
});

test("captureServerFault resolves with minimal context and optional fields absent", async () => {
  await captureServerFault(new Error("boom"), { fn: "demoFn" });
  await captureServerFault(new Error("boom"), { fn: "demoFn", uid: null, durationMs: 0 });
});

test("captureServerFault resolves for non-Error and nullish thrown values", async () => {
  await captureServerFault("string-fault", { fn: "demoFn", uid: "u1" });
  await captureServerFault(undefined, { fn: "demoFn" });
  await captureServerFault({ weird: true }, { fn: "demoFn", uid: null });
});

test("instrumentBackground passes the event through and resolves on success", async () => {
  const seen = [];
  const wrapped = instrumentBackground("demoJob", async (event) => {
    seen.push(event);
  });
  const event = { scheduleTime: "2026-07-21T00:00:00Z" };
  await wrapped(event);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], event); // same object, not a copy
});

test("instrumentBackground rethrows the original error instance on failure", async () => {
  const boom = new Error("job failed");
  const wrapped = instrumentBackground("demoJob", async () => {
    throw boom;
  });
  await assert.rejects(
    () => wrapped({}),
    (e) => e === boom, // runtime must still record the failed execution
  );
});

test("instrumentBackground rethrows non-Error thrown values unchanged", async () => {
  const wrapped = instrumentBackground("demoJob", async () => {
    throw "string-fault";
  });
  await assert.rejects(
    () => wrapped({}),
    (e) => e === "string-fault",
  );
});

test("instrumentBackground reports the failure to capture with the job name", async () => {
  const captures = [];
  const boom = new Error("job failed");
  const wrapped = instrumentBackground(
    "demoJob",
    async () => {
      throw boom;
    },
    { capture: async (...args) => captures.push(args) },
  );
  await assert.rejects(
    () => wrapped({}),
    (e) => e === boom,
  );
  assert.equal(captures.length, 1);
  assert.equal(captures[0][0], boom); // the original error, not a copy
  assert.deepEqual(captures[0][1], { fn: "demoJob" });
});

test("instrumentBackground does NOT call capture on success", async () => {
  const captures = [];
  const wrapped = instrumentBackground("demoJob", async () => {}, {
    capture: async (...args) => captures.push(args),
  });
  await wrapped({});
  assert.equal(captures.length, 0);
});

test("instrumentBackground surfaces the original error even when capture rejects", async () => {
  const boom = new Error("job failed");
  const wrapped = instrumentBackground(
    "demoJob",
    async () => {
      throw boom;
    },
    {
      capture: async () => {
        throw new Error("sentry exploded");
      },
    },
  );
  await assert.rejects(
    () => wrapped({}),
    (e) => e === boom, // the capture failure must never replace the real fault
  );
});
