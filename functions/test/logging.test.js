const test = require("node:test");
const assert = require("node:assert/strict");
// Force the disabled-SDK state before lib/sentry.js loads (via lib/logging.js) — an ambient
// SENTRY_DSN (e.g. a sourced functions/.env) must never make these tests hit the network.
delete process.env.SENTRY_DSN;
process.env.FUNCTIONS_EMULATOR = "true";
const { HttpsError } = require("firebase-functions/v2/https");
const { classifyCallableError, instrumentCallable } = require("../lib/logging.js");

function makeFakeLog(calls) {
  const rec =
    (level) =>
    (...args) =>
      calls.push({ level, args });
  return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
}

test("classifyCallableError: expected HttpsError is a rejection", () => {
  assert.deepEqual(classifyCallableError(new HttpsError("invalid-argument", "bad")), {
    outcome: "rejected",
    code: "invalid-argument",
  });
});

test("classifyCallableError: unknown HttpsError code is a server error", () => {
  assert.deepEqual(classifyCallableError(new HttpsError("internal", "boom")), { outcome: "error" });
});

test("classifyCallableError: non-HttpsError is a server error", () => {
  assert.deepEqual(classifyCallableError(new Error("kaboom")), { outcome: "error" });
});

test("instrumentCallable logs one ok completion and returns the result", async () => {
  const calls = [];
  let t = 1000;
  const wrapped = instrumentCallable("demo", async () => ({ ok: true }), {
    log: makeFakeLog(calls),
    now: () => (t += 5),
  });
  const result = await wrapped({ auth: { uid: "u1" } });
  assert.deepEqual(result, { ok: true });
  const done = calls.find((c) => c.level === "info" && c.args[0] === "callable_done");
  assert.equal(done.args[1].fn, "demo");
  assert.equal(done.args[1].uid, "u1");
  assert.equal(done.args[1].outcome, "ok");
  assert.equal(typeof done.args[1].durationMs, "number");
});

test("instrumentCallable logs expected rejection at warn and rethrows", async () => {
  const calls = [];
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw new HttpsError("permission-denied", "no");
    },
    { log: makeFakeLog(calls), now: () => 0 },
  );
  await assert.rejects(() => wrapped({ auth: { uid: "u1" } }), /no/);
  const warn = calls.find((c) => c.level === "warn");
  assert.equal(warn.args[1].outcome, "rejected");
  assert.equal(warn.args[1].code, "permission-denied");
  assert.ok(!calls.some((c) => c.level === "error"));
});

test("instrumentCallable logs unexpected error at error severity, passing the real Error", async () => {
  const calls = [];
  const boom = new Error("kaboom");
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw boom;
    },
    { log: makeFakeLog(calls), now: () => 0 },
  );
  await assert.rejects(() => wrapped({ auth: null }), /kaboom/);
  const err = calls.find((c) => c.level === "error");
  assert.equal(err.args[0], boom); // real Error -> stack preserved by Cloud Logging
});

test("instrumentCallable calls capture with the error and {fn, uid, durationMs} on a server fault", async () => {
  const captures = [];
  let t = 1000;
  const boom = new Error("kaboom");
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw boom;
    },
    {
      log: makeFakeLog([]),
      now: () => (t += 7),
      capture: async (...args) => {
        captures.push(args);
      },
    },
  );
  await assert.rejects(() => wrapped({ auth: { uid: "u9" } }), /kaboom/);
  assert.equal(captures.length, 1);
  assert.equal(captures[0][0], boom); // the original error, not a copy
  assert.deepEqual(captures[0][1], { fn: "demo", uid: "u9", durationMs: 7 });
});

test("instrumentCallable does NOT call capture for an expected HttpsError rejection", async () => {
  const captures = [];
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw new HttpsError("not-found", "missing");
    },
    { log: makeFakeLog([]), now: () => 0, capture: async (...args) => captures.push(args) },
  );
  await assert.rejects(() => wrapped({ auth: { uid: "u1" } }), /missing/);
  assert.equal(captures.length, 0);
});

test("instrumentCallable does NOT call capture on success", async () => {
  const captures = [];
  const wrapped = instrumentCallable("demo", async () => "ok", {
    log: makeFakeLog([]),
    now: () => 0,
    capture: async (...args) => captures.push(args),
  });
  assert.equal(await wrapped({ auth: { uid: "u1" } }), "ok");
  assert.equal(captures.length, 0);
});

test("instrumentCallable captures unexpected HttpsError codes (internal) as server faults", async () => {
  const captures = [];
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw new HttpsError("internal", "boom");
    },
    { log: makeFakeLog([]), now: () => 0, capture: async (...args) => captures.push(args) },
  );
  await assert.rejects(() => wrapped({ auth: null }), /boom/);
  assert.equal(captures.length, 1);
  assert.equal(captures[0][1].uid, null); // unauthenticated request -> uid null, not undefined
});

test("instrumentCallable passes a non-Error thrown value to capture unchanged", async () => {
  const captures = [];
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw "string-fault";
    },
    { log: makeFakeLog([]), now: () => 0, capture: async (...args) => captures.push(args) },
  );
  await assert.rejects(() => wrapped({ auth: null }));
  assert.equal(captures[0][0], "string-fault");
});

test("instrumentCallable awaits capture completion before the rejection surfaces", async () => {
  let captureFinished = false;
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw new Error("boom");
    },
    {
      log: makeFakeLog([]),
      now: () => 0,
      capture: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        captureFinished = true;
      },
    },
  );
  await assert.rejects(() => wrapped({ auth: null }), /boom/);
  assert.equal(captureFinished, true); // flush happened before rethrow, not in the background
});

test("instrumentCallable surfaces the original error even when capture rejects", async () => {
  const boom = new Error("original-fault");
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw boom;
    },
    {
      log: makeFakeLog([]),
      now: () => 0,
      capture: async () => {
        throw new Error("sentry exploded");
      },
    },
  );
  await assert.rejects(
    () => wrapped({ auth: null }),
    (e) => e === boom, // the capture failure must never replace the real fault
  );
});

test("instrumentCallable default capture (Sentry disabled in tests) still rethrows the original error", async () => {
  const boom = new Error("kaboom");
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw boom;
    },
    { log: makeFakeLog([]), now: () => 0 }, // no capture dep -> real captureServerFault
  );
  await assert.rejects(
    () => wrapped({ auth: null }),
    (e) => e === boom,
  );
});
