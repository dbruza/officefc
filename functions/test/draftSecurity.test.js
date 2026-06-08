const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DraftSecurityError,
  assertValidDraftId,
  evaluateDraftClaim,
  evaluateDraftSubmission,
} = require("../lib/extract/draftSecurity.js");

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof DraftSecurityError && error.code === code);
}

test("draft ids cannot contain a document path", () => {
  expectCode(() => assertValidDraftId("existing/match"), "failed-precondition");
  assert.doesNotThrow(() => assertValidDraftId("safe-firestore-id"));
});

test("extraction cannot claim an id already used by a match", () => {
  expectCode(
    () =>
      evaluateDraftClaim({
        draft: null,
        matchExists: true,
        uid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        force: false,
      }),
    "already-exists",
  );
});

test("an existing draft keeps its owner and storage path", () => {
  const draft = {
    ownerUid: "alice",
    storagePath: "match-photos/alice/m1/source.jpg",
    status: "done",
  };
  expectCode(
    () =>
      evaluateDraftClaim({
        draft,
        matchExists: false,
        uid: "bob",
        storagePath: draft.storagePath,
        force: false,
      }),
    "permission-denied",
  );
  expectCode(
    () =>
      evaluateDraftClaim({
        draft,
        matchExists: false,
        uid: "alice",
        storagePath: "match-photos/alice/m1/replacement.jpg",
        force: false,
      }),
    "failed-precondition",
  );
});

test("concurrent extraction is rejected and completed extraction is reused", () => {
  expectCode(
    () =>
      evaluateDraftClaim({
        draft: {
          ownerUid: "alice",
          storagePath: "match-photos/alice/m1/source.jpg",
          status: "processing",
        },
        matchExists: false,
        uid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        force: false,
      }),
    "failed-precondition",
  );
  assert.equal(
    evaluateDraftClaim({
      draft: {
        ownerUid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        status: "done",
      },
      matchExists: false,
      uid: "alice",
      storagePath: "match-photos/alice/m1/source.jpg",
      force: false,
    }),
    "reuse",
  );
});

test("an abandoning draft cannot be reclaimed by extraction", () => {
  expectCode(
    () =>
      evaluateDraftClaim({
        draft: {
          ownerUid: "alice",
          storagePath: "match-photos/alice/m1/source.jpg",
          status: "abandoning",
        },
        matchExists: false,
        uid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        force: false,
      }),
    "failed-precondition",
  );
});

test("submission refuses to overwrite an unrelated match", () => {
  expectCode(
    () =>
      evaluateDraftSubmission({
        draft: {
          ownerUid: "alice",
          storagePath: "match-photos/alice/m1/source.jpg",
          status: "done",
        },
        match: { source: "manual", submittedBy: "bob" },
        draftId: "m1",
        uid: "alice",
      }),
    "already-exists",
  );
});

test("a successful submission retry is idempotent", () => {
  assert.equal(
    evaluateDraftSubmission({
      draft: {
        ownerUid: "alice",
        storagePath: "match-photos/alice/m1/source.jpg",
        status: "done",
        submitted: true,
        submittedMatchId: "m1",
      },
      match: { source: "ai_assisted", submittedBy: "alice" },
      draftId: "m1",
      uid: "alice",
    }),
    "existing",
  );
});
