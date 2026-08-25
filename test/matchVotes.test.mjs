/**
 * Offline unit tests for the per-match MVP vote logic. Imports the compiled JS
 * (functions/lib/matchVotes.js) so the same file path works whether tests run before or
 * after a source change is compiled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOTE_WINDOW_MS,
  VOTE_SUMMARY_DOC_ID,
  castVoteRejection,
  mergedVoteCandidates,
  computeVoteTally,
} from "../functions/lib/matchVotes.js";

// alice vs bob, confirmed 24 hours ago.
const HOUR = 60 * 60 * 1000;
const CONFIRMED_AT = { toMillis: () => 10_000_000 };
const MID_WINDOW = 10_000_000 + 24 * HOUR;
const PAST_WINDOW = 10_000_000 + VOTE_WINDOW_MS;

const confirmed = {
  status: "confirmed",
  finals: false,
  aId: "alice",
  bId: "bob",
  confirmedAt: CONFIRMED_AT,
};

// --- castVoteRejection: who may vote ---

test("a participant may vote for their opponent mid-window", () => {
  assert.equal(castVoteRejection(confirmed, "alice", "bob", MID_WINDOW), null);
});

test("either participant is a valid candidate — but never yourself", () => {
  assert.equal(castVoteRejection(confirmed, "alice", "bob", MID_WINDOW), null);
  // Bob may vote for Alice even though she submitted... and may NOT pick himself.
  assert.equal(castVoteRejection(confirmed, "bob", "alice", MID_WINDOW), null);
  assert.equal(castVoteRejection(confirmed, "bob", "bob", MID_WINDOW), "self_vote");
  assert.equal(castVoteRejection(confirmed, "alice", "alice", MID_WINDOW), "self_vote");
});

test("only the two participants may vote at all", () => {
  assert.equal(castVoteRejection(confirmed, "carol", "alice", MID_WINDOW), "not_participant");
  // A non-participant gets permission-denied even with a garbage candidate id — the
  // authorization answer must not leak the match's state to outsiders.
  assert.equal(castVoteRejection(confirmed, "carol", "carol", MID_WINDOW), "not_participant");
});

test("self-vote beats unknown-candidate (you can't launder a self-vote)", () => {
  // "dave" isn't in the match; voting for yourself is still reported as self_vote because
  // the self check runs first.
  assert.equal(castVoteRejection(confirmed, "alice", "alice", MID_WINDOW), "self_vote");
  assert.equal(castVoteRejection(confirmed, "alice", "dave", MID_WINDOW), "unknown_candidate");
});

// --- castVoteRejection: which matches qualify ---

test("finals matches are excluded from MVP voting entirely", () => {
  const finals = { ...confirmed, finals: true };
  assert.equal(castVoteRejection(finals, "alice", "bob", MID_WINDOW), "finals_match");
  // Without the flag the same match is votable — the flag is what excludes it.
  assert.equal(castVoteRejection({ ...confirmed }, "alice", "bob", MID_WINDOW), null);
});

test("unconfirmed matches cannot be voted on", () => {
  assert.equal(
    castVoteRejection({ ...confirmed, status: "pending_confirmation" }, "alice", "bob", MID_WINDOW),
    "not_confirmed",
  );
  assert.equal(
    castVoteRejection({ ...confirmed, status: "disputed" }, "alice", "bob", MID_WINDOW),
    "not_confirmed",
  );
  assert.equal(
    castVoteRejection({ ...confirmed, status: "voided" }, "alice", "bob", MID_WINDOW),
    "not_confirmed",
  );
});

// --- castVoteRejection: the 48h window ---

test("the window is open through hour 48 and shut after", () => {
  const justInside = 10_000_000 + VOTE_WINDOW_MS - 1;
  assert.equal(castVoteRejection(confirmed, "alice", "bob", justInside), null);
  assert.equal(castVoteRejection(confirmed, "alice", "bob", PAST_WINDOW), "window_closed");
  assert.equal(castVoteRejection(confirmed, "alice", "bob", PAST_WINDOW + HOUR), "window_closed");
});

test("an unreadable confirmation stamp closes the window rather than opening it forever", () => {
  // Same philosophy as canAutoConfirm's missing-createdAt guard: un-ageable means CLOSED.
  const noStamp = { ...confirmed };
  delete noStamp.confirmedAt;
  assert.equal(castVoteRejection(noStamp, "alice", "bob", MID_WINDOW), "no_confirmation_time");
  assert.equal(
    castVoteRejection({ ...confirmed, confirmedAt: "garbage" }, "alice", "bob", MID_WINDOW),
    "no_confirmation_time",
  );
});

test("an ISO-string confirmedAt is honoured like a Timestamp", () => {
  const iso = new Date(10_000_000).toISOString();
  const match = { ...confirmed, confirmedAt: iso };
  assert.equal(castVoteRejection(match, "alice", "bob", 10_000_000 + 1 * HOUR), null);
  assert.equal(castVoteRejection(match, "alice", "bob", 10_000_000 + 49 * HOUR), "window_closed");
});

// --- mergedVoteCandidates: re-votes replace, strays are skipped ---

test("a re-vote replaces the voter's previous choice, others are kept", () => {
  // Prior state: bob voted for alice, alice voted for bob.
  const prior = [
    { id: "bob", candidateId: "alice" },
    { id: "alice", candidateId: "bob" },
  ];
  // Alice changes her vote to... bob again (same pick) → still exactly one alice vote.
  assert.deepEqual(mergedVoteCandidates(prior, "alice", "bob"), ["alice", "bob"]);
  // Alice switches to herself? Blocked upstream — but even so she contributes one vote,
  // not two: her previous doc is replaced before counting.
  assert.deepEqual(mergedVoteCandidates(prior, "alice", "alice"), ["alice", "alice"]);
  // And the other voter's doc survives untouched when bob re-votes.
  assert.deepEqual(mergedVoteCandidates(prior, "bob", "bob"), ["bob", "bob"]);
});

test("the _summary aggregate doc is never counted as a vote", () => {
  const prior = [
    { id: "bob", candidateId: "alice" },
    { id: VOTE_SUMMARY_DOC_ID, candidateId: "alice" },
  ];
  assert.deepEqual(mergedVoteCandidates(prior, "alice", "bob"), ["alice", "bob"]);
});

test("a vote doc with a non-string candidateId is dropped from the tally", () => {
  const prior = [
    { id: "bob", candidateId: "alice" },
    { id: "carol", candidateId: 42 },
  ];
  assert.deepEqual(mergedVoteCandidates(prior, "alice", "bob"), ["alice", "bob"]);
});

test("an empty votes collection yields just the new vote", () => {
  assert.deepEqual(mergedVoteCandidates([], "alice", "bob"), ["bob"]);
});

// --- computeVoteTally: counts, leaders, ties ---

test("votes are counted per candidate and the outright leader wins", () => {
  const t = computeVoteTally(["bob", "bob", "alice"]);
  assert.deepEqual(t.tally, { bob: 2, alice: 1 });
  assert.equal(t.leaderId, "bob");
  assert.equal(t.totalVotes, 3);
});

test("a tied tally elects nobody (leaderId null)", () => {
  const t = computeVoteTally(["bob", "alice"]);
  assert.deepEqual(t.tally, { bob: 1, alice: 1 });
  assert.equal(t.leaderId, null);
  assert.equal(t.totalVotes, 2);
});

test("no votes at all means no leader", () => {
  const t = computeVoteTally([]);
  assert.deepEqual(t.tally, {});
  assert.equal(t.leaderId, null);
  assert.equal(t.totalVotes, 0);
});

test("the leader stays decided when a third value appears only via strays", () => {
  // validCandidates filters BEFORE counting: a stray vote can inflate nothing and
  // manufacture neither a leader nor a tie.
  const t = computeVoteTally(["bob", "bob", "mallory"], ["alice", "bob"]);
  assert.deepEqual(t.tally, { bob: 2 });
  assert.equal(t.leaderId, "bob");
  assert.equal(t.totalVotes, 2);
});

test("stray votes can't turn an outright winner into a tie", () => {
  const t = computeVoteTally(["bob", "alice", "mallory"], ["alice", "bob"]);
  assert.deepEqual(t.tally, { bob: 1, alice: 1 });
  assert.equal(t.leaderId, null);
  assert.equal(t.totalVotes, 2);
});
