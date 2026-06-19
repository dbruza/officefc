const test = require("node:test");
const assert = require("node:assert/strict");
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
