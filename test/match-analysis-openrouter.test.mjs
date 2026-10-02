/* Unit tests for the OpenRouter client + fallback chain: bounded retry/backoff on
   transient failures, immediate fall-through to the next model on permanent errors and
   validation failures, and success on the first usable output. fetch and sleep are
   injected so the test is fast and deterministic. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRequest,
  callOpenRouter,
  callWithFallbackChain,
} from "../functions/src/matchAnalysis/core/openrouter.mjs";

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

const baseOpts = { apiKey: "k", requestOpts: { systemPrompt: "s", userPrompt: "u" } };

test("buildChatRequest shapes an OpenRouter chat body", () => {
  const req = buildChatRequest({ systemPrompt: "sys", userPrompt: "usr", model: "m:free" });
  assert.equal(req.model, "m:free");
  assert.equal(req.messages[0].role, "system");
  assert.equal(req.messages[1].content, "usr");
});

test("callOpenRouter retries a 429 then succeeds", async () => {
  let n = 0;
  const out = await callOpenRouter({
    apiKey: "k",
    request: { model: "m" },
    sleepImpl: noSleep,
    fetchImpl: async () =>
      n++ === 0
        ? res(429, { error: "rate" })
        : res(200, { choices: [{ message: { content: "hi" } }] }),
  });
  assert.deepEqual(out, { content: "hi" });
  assert.equal(n, 2);
});

test("callOpenRouter does not retry a 401", async () => {
  let n = 0;
  await assert.rejects(
    callOpenRouter({
      apiKey: "k",
      request: { model: "m" },
      sleepImpl: noSleep,
      fetchImpl: async () => (n++, res(401, { error: "bad key" })),
    }),
    /401/,
  );
  assert.equal(n, 1);
});

test("callWithFallbackChain skips a permanently failing model and uses the next", async () => {
  const seen = [];
  const out = await callWithFallbackChain({
    ...baseOpts,
    models: ["a:free", "b:free"],
    sleepImpl: noSleep,
    fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      return model === "a:free"
        ? res(404, { error: "no provider" })
        : res(200, { choices: [{ message: { content: "ok" } }] });
    },
  });
  assert.equal(out.model, "b:free");
  assert.deepEqual(seen, ["a:free", "b:free"]);
});

test("callWithFallbackChain treats invalid JSON output as a failed attempt", async () => {
  let callsForB = 0;
  const parseAnalysis = (content) => {
    if (!content.includes('"headline"')) throw new Error("missing fields");
    return { headline: content };
  };
  const out = await callWithFallbackChain({
    ...baseOpts,
    models: ["a:free", "b:free"],
    validate: parseAnalysis,
    sleepImpl: noSleep,
    fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model;
      if (model === "b:free") {
        callsForB += 1;
        return res(200, { choices: [{ message: { content: '{"headline":"H","summary":"S"}' } }] });
      }
      return res(200, { choices: [{ message: { content: "I am a chatty model, no json here" } }] });
    },
  });
  assert.equal(out.model, "b:free");
  assert.ok(callsForB >= 1);
});

test("callWithFallbackChain throws when every model fails", async () => {
  await assert.rejects(
    callWithFallbackChain({
      ...baseOpts,
      models: ["a:free"],
      sleepImpl: noSleep,
      fetchImpl: async () => res(500, { error: "down" }),
    }),
    /500|all models/i,
  );
});

test("the chain honors a total deadline and never sleeps past it", async () => {
  let calls = 0,
    sleeps = 0;
  await assert.rejects(
    callWithFallbackChain({
      ...baseOpts,
      models: ["a:free", "b:free"],
      deadlineMs: Date.now() + 50,
      fetchImpl: async () => {
        calls++;
        return {
          ok: false,
          status: 429,
          headers: { get: () => "120" },
          text: async () => "limited",
        };
      },
      sleepImpl: async () => {
        sleeps++;
      },
    }),
  );
  assert.equal(calls, 2);
  assert.equal(sleeps, 0);
});
test("a stalled response body is still covered by cancellation", async () => {
  await assert.rejects(
    callOpenRouter({
      apiKey: "fake",
      request: {},
      timeoutMs: 10,
      maxAttempts: 1,
      fetchImpl: async (_url, { signal }) => ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("body aborted")), {
              once: true,
            });
          }),
      }),
    }),
    /body aborted/,
  );
});
