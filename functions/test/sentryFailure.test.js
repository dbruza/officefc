const test = require("node:test");
const assert = require("node:assert/strict");

// Own test file so the require.cache stub can't leak into other suites (node --test runs
// each file in its own process). The stub makes every SDK call throw, proving the
// "never throws" contract of captureServerFault holds even with a hostile SDK.
delete process.env.SENTRY_DSN;
process.env.FUNCTIONS_EMULATOR = "true";

const sentryPath = require.resolve("@sentry/node");
require.cache[sentryPath] = {
  id: sentryPath,
  filename: sentryPath,
  loaded: true,
  exports: {
    init() {},
    onUnhandledRejectionIntegration() {
      return {};
    },
    withScope() {
      throw new Error("sdk blew up");
    },
    captureException() {
      throw new Error("sdk blew up");
    },
    flush: async () => {
      throw new Error("flush failed");
    },
  },
};
const { captureServerFault } = require("../lib/sentry.js");

test("captureServerFault resolves even when the Sentry SDK throws", async () => {
  await assert.doesNotReject(() =>
    captureServerFault(new Error("boom"), { fn: "demo", uid: "u1", durationMs: 5 }),
  );
});
