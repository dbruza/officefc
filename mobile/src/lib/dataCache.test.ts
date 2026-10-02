import test from "node:test";
import assert from "node:assert/strict";
import { DataCache } from "./dataCache";
test("simultaneous readers share a request and a fresh value", async () => {
  let calls = 0,
    now = 100;
  const cache = new DataCache(2, () => now);
  const load = async () => ++calls;
  assert.deepEqual(
    await Promise.all([cache.read("a", load, 10), cache.read("a", load, 10)]),
    [1, 1],
  );
  assert.equal(await cache.read("a", load, 10), 1);
  now = 111;
  assert.equal(await cache.read("a", load, 10), 2);
});
test("sign-out clears values and late requests cannot restore them", async () => {
  const cache = new DataCache();
  let finish!: (value: string) => void;
  const pending = cache.read(
    "roster",
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  cache.invalidate(true);
  await cache.read("roster", async () => "new account");
  finish("old account");
  await pending;
  assert.equal(cache.peek("roster"), "new account");
});
test("a successful mutation invalidates in-flight work without dropping visible data", async () => {
  const cache = new DataCache();
  await cache.read("a", async () => 1);
  cache.invalidate();
  assert.equal(cache.peek("a"), 1);
  assert.equal(cache.fresh("a"), false);
  assert.equal(await cache.read("a", async () => 2), 2);
});
test("failed reads can retry and least recently used values are evicted", async () => {
  const cache = new DataCache(2);
  await assert.rejects(
    cache.read("bad", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(await cache.read("bad", async () => 1), 1);
  await cache.read("next", async () => 2);
  await cache.read("bad", async () => 3);
  await cache.read("last", async () => 4);
  assert.equal(cache.peek("next"), undefined);
  assert.equal(cache.peek("bad"), 1);
});
