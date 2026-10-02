const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPushMessages, deliverPushMessages } = require("../lib/notify.js");

const sample = {
  to: "ExponentPushToken[abc]",
  sound: "default",
  title: "t",
  body: "b",
  data: {},
};

test("buildPushMessages keeps only valid Expo tokens and shapes the payload", () => {
  const messages = buildPushMessages(
    ["ExponentPushToken[abc]", "ExpoPushToken[def]", "not-a-token", null, 42, undefined],
    "Match confirmed",
    "Alice 3–1 Bob",
    { matchId: "m1" },
  );

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    to: "ExponentPushToken[abc]",
    sound: "default",
    title: "Match confirmed",
    body: "Alice 3–1 Bob",
    data: { matchId: "m1" },
  });
});

test("buildPushMessages returns nothing when no token is valid", () => {
  assert.deepEqual(buildPushMessages(["garbage", null], "t", "b", {}), []);
});

test("deliverPushMessages POSTs once to Expo for a non-empty batch", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true };
  };

  const sent = await deliverPushMessages([sample], fakeFetch);

  assert.equal(sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://exp.host/--/api/v2/push/send");
  assert.equal(calls[0].init.method, "POST");
});

test("deliverPushMessages skips the network for an empty batch", async () => {
  let called = false;
  const sent = await deliverPushMessages([], async () => {
    called = true;
  });

  assert.equal(sent, false);
  assert.equal(called, false);
});

test("deliverPushMessages swallows transport errors so the caller never fails", async () => {
  const originalWarn = console.warn;
  console.warn = () => {}; // keep the deliberate failure out of the test log
  try {
    const sent = await deliverPushMessages([sample], async () => {
      throw new Error("network down");
    });
    assert.equal(sent, false);
  } finally {
    console.warn = originalWarn;
  }
});

test("push responses are drained before returning the connection to the pool", async () => {
  let drained = false;
  assert.equal(
    await deliverPushMessages([sample], async () => ({
      ok: true,
      arrayBuffer: async () => {
        drained = true;
        return new ArrayBuffer(0);
      },
    })),
    true,
  );
  assert.equal(drained, true);
});
