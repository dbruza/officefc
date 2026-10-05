const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isOffensiveName,
  displayNameProblem,
  neutralProfileName,
  memberStatusOf,
  nextBlockList,
  blockListOf,
  isReportReason,
} = require("../lib/models/safety.js");
const { activeMemberIds, isActiveMember } = require("../lib/members.js");
const { matchErasure } = require("../lib/account.js");

test("ordinary names, including ones that contain blocked letters, pass", () => {
  for (const name of [
    "Sam Kerr",
    "Cassandra",
    "Shital Patel",
    "Dick Advocaat",
    "Scunthorpe United",
    "Hancock",
    "Wankhede",
    "Titan",
    "Cumberbatch",
    "Sasha Slutsky",
    "Nigam",
  ])
    assert.equal(isOffensiveName(name), false, name);
});

test("offensive words are caught as words, inflections, leetspeak and hidden slurs", () => {
  for (const name of [
    "fuck",
    "Fucker FC",
    "sh1t",
    "big_wanker",
    "B1TCHES",
    "Hitler",
    "x n i g g e r x",
    "superfaggot99",
    "Crüe Cunt",
  ])
    assert.equal(isOffensiveName(name), true, name);
});

test("displayNameProblem enforces length and language", () => {
  assert.equal(displayNameProblem("Sam"), null);
  assert.match(displayNameProblem(" a "), /at least 2/);
  assert.match(displayNameProblem("x".repeat(41)), /40 characters/);
  assert.match(displayNameProblem("Shit Player"), /offensive/);
});

test("neutral names fall back cleanly without a valid jersey", () => {
  assert.deepEqual(neutralProfileName(7), { displayName: "Player 7", handle: "player7" });
  assert.deepEqual(neutralProfileName(undefined), { displayName: "Player", handle: "player" });
  assert.deepEqual(neutralProfileName(150), { displayName: "Player", handle: "player" });
  assert.equal(isOffensiveName(neutralProfileName(7).handle), false);
});

test("member status defaults to active; only known statuses lock a member out", () => {
  assert.equal(memberStatusOf({}), "active");
  assert.equal(memberStatusOf(undefined), "active");
  assert.equal(memberStatusOf({ status: "removed" }), "removed");
  assert.equal(memberStatusOf({ status: "deleted" }), "deleted");
  assert.equal(memberStatusOf({ status: "weird" }), "active");

  const doc = (id, data) => ({ id, exists: true, get: (field) => data[field] });
  assert.deepEqual(
    activeMemberIds([
      doc("a", { role: "member" }),
      doc("b", { status: "removed" }),
      doc("c", { status: "deleted" }),
    ]),
    ["a"],
  );
  assert.equal(isActiveMember({ exists: false, get: () => undefined }), false);
});

test("block lists stay de-duplicated, ignore junk and unblock cleanly", () => {
  assert.deepEqual(nextBlockList(undefined, "x", true), ["x"]);
  assert.deepEqual(nextBlockList(["x", 3, null], "x", true), ["x"]);
  assert.deepEqual(nextBlockList(["x", "y"], "x", false), ["y"]);
  assert.deepEqual(blockListOf({ blocked: ["a", 1] }), ["a"]);
  assert.deepEqual(blockListOf(null), []);
  assert.equal(nextBlockList([], "z", true).length, 1);
});

test("report reasons are a closed list", () => {
  assert.equal(isReportReason("harassment"), true);
  assert.equal(isReportReason("spam"), false);
  assert.equal(isReportReason(undefined), false);
});

test("account erasure voids open matches and strips the user's photos and dispute text", () => {
  const pending = matchErasure("me", {
    status: "pending_confirmation",
    submittedBy: "me",
    aId: "me",
    bId: "them",
    aGoals: 2,
    bGoals: 1,
    photoPath: "match-photos/me/d1/source.jpg",
  });
  assert.equal(pending.status, "voided");
  assert.equal(pending.previousStatus, "pending_confirmation");
  assert.deepEqual(pending.previousScore, { aGoals: 2, bGoals: 1 });
  assert.ok("photoPath" in pending && "photoDeletedAt" in pending);

  const disputed = matchErasure("me", {
    status: "disputed",
    submittedBy: "them",
    disputedBy: "me",
    disputeReason: "wrong score",
  });
  assert.equal(disputed.status, "voided");
  assert.ok("disputeReason" in disputed);

  // Confirmed history stays (opponents keep their results); only personal bits go.
  assert.equal(matchErasure("me", { status: "confirmed", submittedBy: "them" }), null);
  const confirmedWithPhoto = matchErasure("me", {
    status: "confirmed",
    submittedBy: "me",
    photoPath: "match-photos/me/d2/source.jpg",
  });
  assert.equal(confirmedWithPhoto.status, undefined);
  assert.ok("photoPath" in confirmedWithPhoto);
  // The opponent's photo isn't theirs to delete.
  assert.equal(
    matchErasure("me", { status: "confirmed", submittedBy: "them", photoPath: "p" }),
    null,
  );
});
