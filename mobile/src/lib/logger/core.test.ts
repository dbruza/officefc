import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeContext, LogBuffer, isSlow, extractDuration } from "./core";

test("sanitizeContext keeps bounded scalars and redacts sensitive keys", () => {
  const out = sanitizeContext({ uid: "u1", count: 3, ok: true, authToken: "secret", note: null });
  assert.deepEqual(out, { uid: "u1", count: 3, ok: true, authToken: "[redacted]", note: null });
});

test("sanitizeContext drops non-scalar values", () => {
  const out = sanitizeContext({ nested: { a: 1 }, list: [1, 2] });
  assert.deepEqual(out, { nested: "[unsupported]", list: "[unsupported]" });
});

test("sanitizeContext truncates long strings", () => {
  const out = sanitizeContext({ blob: "x".repeat(600) });
  assert.equal((out.blob as string).length, 501); // 500 + ellipsis
});

test("LogBuffer drops oldest on overflow and drains", () => {
  const b = new LogBuffer(2);
  const e = (n: number) => ({ level: "warn" as const, event: "e" + n, context: {}, clientTs: n });
  b.push(e(1));
  b.push(e(2));
  b.push(e(3));
  assert.deepEqual(
    b.drain().map((x) => x.event),
    ["e2", "e3"],
  );
  assert.equal(b.size, 0);
});

test("isSlow compares against the threshold", () => {
  assert.equal(isSlow(1500), true);
  assert.equal(isSlow(1499), false);
  assert.equal(isSlow(50, 40), true);
});

test("sanitizeContext omits undefined values instead of tagging them", () => {
  const out = sanitizeContext({ label: "x", count: undefined });
  assert.deepEqual(out, { label: "x" });
});

test("extractDuration hoists a numeric durationMs out of context", () => {
  const r = extractDuration({ label: "x", durationMs: 1700, count: 3 });
  assert.equal(r.durationMs, 1700);
  assert.deepEqual(r.context, { label: "x", count: 3 });
});

test("extractDuration leaves context untouched when durationMs is absent", () => {
  const r = extractDuration({ label: "x" });
  assert.equal(r.durationMs, undefined);
  assert.deepEqual(r.context, { label: "x" });
});
