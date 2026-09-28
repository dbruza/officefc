/* Unit tests for callModel's transport behaviour: timeout-bounded attempts with bounded
   retry/backoff for transient failures, and no retry for client errors. fetch and sleep are
   injected so the test is fast and deterministic (no network, no real waiting). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel } from "../functions/src/extract/core/openrouter.mjs";

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const noSleep = async () => {};

test("retries a 429 then returns the success body", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1 ? res(429, { error: "overloaded" }) : res(200, { ok: true });
  };
  const out = await callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl: noSleep });
  assert.deepEqual(out, { ok: true });
  assert.equal(n, 2);
});

test("gives up after maxAttempts on a persistent 500", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return res(500, { error: "boom" });
  };
  await assert.rejects(
    () => callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl: noSleep, maxAttempts: 3 }),
    /OpenRouter API 500/,
  );
  assert.equal(n, 3);
});

test("does not retry a non-retryable 400", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return res(400, { error: "bad request" });
  };
  await assert.rejects(
    () => callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl: noSleep }),
    /OpenRouter API 400/,
  );
  assert.equal(n, 1);
});

test("retries a network error / timeout abort", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) throw new Error("aborted");
    return res(200, { ok: true });
  };
  const out = await callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl: noSleep });
  assert.deepEqual(out, { ok: true });
  assert.equal(n, 2);
});

test("aborts a hung request via the real timeout wiring, then retries", async () => {
  // First attempt never resolves on its own; it must be the AbortController's setTimeout firing
  // that rejects it. This exercises the actual signal/timer path, not a synchronous throw.
  let n = 0;
  const fetchImpl = (_url, opts) => {
    n += 1;
    if (n === 1) {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }
    return Promise.resolve(res(200, { ok: true }));
  };
  const out = await callModel({
    apiKey: "k",
    request: {},
    fetchImpl,
    sleepImpl: noSleep,
    timeoutMs: 10,
  });
  assert.deepEqual(out, { ok: true });
  assert.equal(n, 2);
});

test("honors the retry-after header for the backoff wait", async () => {
  let waited = -1;
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1 ? res(429, {}, { "retry-after": "2" }) : res(200, { ok: true });
  };
  const sleepImpl = async (ms) => {
    waited = ms;
  };
  await callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl });
  assert.equal(waited, 2000);
});

test("throws immediately without an API key", async () => {
  await assert.rejects(
    () => callModel({ request: {}, fetchImpl: async () => res(200, {}) }),
    /missing OpenRouter API key/,
  );
});

test("fails at once when OpenRouter is out of credits (402)", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return res(402, { error: { message: "Insufficient credits" } });
  };
  await assert.rejects(
    () => callModel({ apiKey: "k", request: {}, fetchImpl, sleepImpl: noSleep }),
    /OpenRouter API 402/,
  );
  assert.equal(n, 1);
});

test("posts to chat completions with a bearer key", async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return res(200, { ok: true });
  };
  await callModel({ apiKey: "k", request: { model: "m" }, fetchImpl, sleepImpl: noSleep });
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.opts.headers.authorization, "Bearer k");
  assert.deepEqual(JSON.parse(seen.opts.body), { model: "m" });
});
