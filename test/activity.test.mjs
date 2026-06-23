/**
 * Unit tests for the pure activity-feed event derivation.
 * Imports the compiled JS (functions/lib/activity.js) so the same path works whether
 * tests run before or after a source change is compiled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMatchActivity, deriveSeasonActivity } from "../functions/lib/activity.js";

/** A confirmed 3–1 home win, both players mid-table, no streak/leader change. */
function baseMatch(overrides = {}) {
  return {
    matchId: "m1",
    seasonId: "s1",
    aId: "alice",
    bId: "bob",
    aGoals: 3,
    bGoals: 1,
    aEloBefore: 1500,
    bEloBefore: 1500,
    aDelta: 10,
    bDelta: -10,
    winnerStreak: 1,
    winnerStreakType: "W",
    previousLeaderId: "alice",
    newLeaderId: "alice",
    ...overrides,
  };
}

test("every confirmed match emits exactly one match_result event", () => {
  const events = deriveMatchActivity(baseMatch());
  const result = events.filter((e) => e.type === "match_result");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "result_m1");
  assert.equal(result[0].seasonId, "s1");
  assert.deepEqual(result[0].actorIds.sort(), ["alice", "bob"]);
  assert.deepEqual(result[0].payload, {
    matchId: "m1",
    aId: "alice",
    bId: "bob",
    aGoals: 3,
    bGoals: 1,
    aDelta: 10,
    bDelta: -10,
  });
});

test("a draw emits only a match_result (no upset, no streak)", () => {
  const events = deriveMatchActivity(
    baseMatch({
      aGoals: 2,
      bGoals: 2,
      aDelta: 0,
      bDelta: 0,
      winnerStreak: null,
      winnerStreakType: null,
    }),
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["match_result"],
  );
});

test("upset fires when the winner was at least 100 Elo below the loser", () => {
  const events = deriveMatchActivity(
    baseMatch({ aEloBefore: 1400, bEloBefore: 1500 }), // alice (winner) 100 below bob
  );
  const upset = events.find((e) => e.type === "upset");
  assert.ok(upset, "expected an upset event");
  assert.equal(upset.id, "upset_m1");
  assert.equal(upset.payload.winnerId, "alice");
  assert.equal(upset.payload.loserId, "bob");
  assert.equal(upset.payload.winnerEloBefore, 1400);
  assert.equal(upset.payload.loserEloBefore, 1500);
  assert.equal(upset.payload.gap, 100);
});

test("no upset when the gap is under 100", () => {
  const events = deriveMatchActivity(baseMatch({ aEloBefore: 1410, bEloBefore: 1500 }));
  assert.equal(
    events.some((e) => e.type === "upset"),
    false,
  );
});

test("no upset when the favourite (higher-rated) wins", () => {
  const events = deriveMatchActivity(baseMatch({ aEloBefore: 1700, bEloBefore: 1500 }));
  assert.equal(
    events.some((e) => e.type === "upset"),
    false,
  );
});

test("streak fires only at a 3/5/10 milestone, keyed by the winner", () => {
  for (const count of [3, 5, 10]) {
    const events = deriveMatchActivity(baseMatch({ winnerStreak: count }));
    const streak = events.find((e) => e.type === "streak");
    assert.ok(streak, `expected a streak event at ${count}`);
    assert.equal(streak.id, "streak_m1_alice");
    assert.equal(streak.payload.playerId, "alice");
    assert.equal(streak.payload.count, count);
  }
});

test("no streak event between milestones", () => {
  for (const count of [1, 2, 4, 6, 9, 11]) {
    const events = deriveMatchActivity(baseMatch({ winnerStreak: count }));
    assert.equal(
      events.some((e) => e.type === "streak"),
      false,
      `unexpected streak at ${count}`,
    );
  }
});

test("a non-win streak type never emits a streak event", () => {
  const events = deriveMatchActivity(baseMatch({ winnerStreak: 3, winnerStreakType: "D" }));
  assert.equal(
    events.some((e) => e.type === "streak"),
    false,
  );
});

test("new_number_one fires when the leader changes", () => {
  const events = deriveMatchActivity(baseMatch({ previousLeaderId: "bob", newLeaderId: "alice" }));
  const lead = events.find((e) => e.type === "new_number_one");
  assert.ok(lead, "expected a new_number_one event");
  assert.equal(lead.id, "numberone_m1");
  assert.equal(lead.payload.playerId, "alice");
  assert.equal(lead.payload.previousLeaderId, "bob");
  assert.deepEqual(lead.actorIds.sort(), ["alice", "bob"]);
});

test("new_number_one fires for the first-ever leader (previous null)", () => {
  const events = deriveMatchActivity(baseMatch({ previousLeaderId: null, newLeaderId: "alice" }));
  const lead = events.find((e) => e.type === "new_number_one");
  assert.ok(lead);
  assert.equal(lead.payload.previousLeaderId, null);
  assert.deepEqual(lead.actorIds, ["alice"]);
});

test("no new_number_one when the leader is unchanged", () => {
  const events = deriveMatchActivity(
    baseMatch({ previousLeaderId: "alice", newLeaderId: "alice" }),
  );
  assert.equal(
    events.some((e) => e.type === "new_number_one"),
    false,
  );
});

test("no new_number_one when there is still no ranked leader", () => {
  const events = deriveMatchActivity(baseMatch({ previousLeaderId: null, newLeaderId: null }));
  assert.equal(
    events.some((e) => e.type === "new_number_one"),
    false,
  );
});

test("season derivation emits a champion and one POTM per month", () => {
  const events = deriveSeasonActivity({
    seasonId: "s1",
    seasonName: "Spring 2026",
    championId: "alice",
    runnerUpId: "bob",
    potm: [
      { month: "2026-03", playerId: "alice", gain: 42 },
      { month: "2026-04", playerId: "bob", gain: 31 },
    ],
  });
  const champion = events.find((e) => e.type === "champion");
  assert.ok(champion);
  assert.equal(champion.id, "champion_s1");
  assert.equal(champion.payload.playerId, "alice");
  assert.equal(champion.payload.runnerUpId, "bob");
  assert.equal(champion.payload.seasonName, "Spring 2026");

  const potm = events.filter((e) => e.type === "potm");
  assert.equal(potm.length, 2);
  assert.deepEqual(potm.map((e) => e.id).sort(), ["potm_s1_2026-03", "potm_s1_2026-04"]);
  assert.equal(potm[0].payload.month, "2026-03");
  assert.equal(potm[0].payload.gain, 42);
});

test("season derivation with no champion emits nothing", () => {
  const events = deriveSeasonActivity({
    seasonId: "s1",
    seasonName: "Spring 2026",
    championId: null,
    runnerUpId: null,
    potm: [],
  });
  assert.deepEqual(events, []);
});
