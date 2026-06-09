const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateDraftAbandonment,
  isStaleUnsubmittedDraft,
} = require("../lib/extract/draftLifecycle.js");
const { DraftSecurityError } = require("../lib/extract/draftSecurity.js");

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof DraftSecurityError && error.code === code);
}

test("missing draft abandonment is idempotent", () => {
  assert.deepEqual(evaluateDraftAbandonment({ draft: null, matchExists: false, uid: "alice" }), {
    action: "missing",
  });
});

test("only the draft owner can abandon a draft", () => {
  expectCode(
    () =>
      evaluateDraftAbandonment({
        draft: {
          ownerUid: "alice",
          storagePath: "match-photos/alice/m1/source.jpg",
          submitted: false,
        },
        matchExists: false,
        uid: "bob",
      }),
    "permission-denied",
  );
});

test("submitted drafts and match-backed drafts are protected", () => {
  expectCode(
    () =>
      evaluateDraftAbandonment({
        draft: {
          ownerUid: "alice",
          storagePath: "match-photos/alice/m1/source.jpg",
          submitted: true,
        },
        matchExists: true,
        uid: "alice",
      }),
    "failed-precondition",
  );
  expectCode(
    () => evaluateDraftAbandonment({ draft: null, matchExists: true, uid: "alice" }),
    "failed-precondition",
  );
});

test("owner can mark an unsubmitted draft for abandonment", () => {
  assert.deepEqual(
    evaluateDraftAbandonment({
      draft: {
        ownerUid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        submitted: false,
      },
      matchExists: false,
      uid: "alice",
    }),
    { action: "abandon", storagePath: "match-photos/alice/m1/source.jpg" },
  );
});

test("stale cleanup only selects unsubmitted drafts at least 24 hours old", () => {
  const cutoffMillis = 1_000_000;
  assert.equal(
    isStaleUnsubmittedDraft({ createdAtMillis: cutoffMillis, submitted: false, cutoffMillis }),
    true,
  );
  assert.equal(
    isStaleUnsubmittedDraft({ createdAtMillis: cutoffMillis + 1, submitted: false, cutoffMillis }),
    false,
  );
  assert.equal(
    isStaleUnsubmittedDraft({ createdAtMillis: cutoffMillis - 1, submitted: true, cutoffMillis }),
    false,
  );
  assert.equal(
    isStaleUnsubmittedDraft({ createdAtMillis: 0, submitted: false, cutoffMillis }),
    false,
  );
});
