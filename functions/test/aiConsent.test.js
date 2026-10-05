const test = require("node:test");
const assert = require("node:assert/strict");
// Force the disabled-SDK state before lib/sentry.js loads (via lib/logging.js) — an ambient
// SENTRY_DSN (e.g. a sourced functions/.env) must never make these tests hit the network.
delete process.env.SENTRY_DSN;
process.env.FUNCTIONS_EMULATOR = "true";
const {
  AI_PHOTO_CONSENT_REQUIRED,
  aiPhotoConsentRequired,
  hasAiPhotoConsent,
} = require("../lib/extract/aiConsent.js");
const { classifyCallableError } = require("../lib/logging.js");

test("only an explicit aiPhotoReading: true counts as consent", () => {
  assert.equal(hasAiPhotoConsent({ aiPhotoReading: true }), true);
  assert.equal(hasAiPhotoConsent({ aiPhotoReading: true, termsAcceptedAt: {} }), true);
  // A missing doc (data() is undefined), a withdrawn opt-in, and junk shapes are all a no.
  for (const data of [undefined, null, {}, { aiPhotoReading: false }, { aiPhotoReading: "true" }]) {
    assert.equal(hasAiPhotoConsent(data), false, JSON.stringify(data));
  }
});

test("missing consent is an expected rejection the app can recognise", () => {
  const error = aiPhotoConsentRequired();
  assert.deepEqual(classifyCallableError(error), {
    outcome: "rejected",
    code: "failed-precondition",
  });
  assert.deepEqual(error.details, { reason: AI_PHOTO_CONSENT_REQUIRED });
  // Older apps show a failed-precondition message as-is only when it reads as a sentence
  // (mobile/src/lib/friendlyError.ts): whitespace and at most 200 characters.
  assert.ok(/\s/.test(error.message) && error.message.length <= 200);
  assert.match(error.message, /log the match manually/);
});
