const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveLeagueStats,
  _internals: { pairKeyFor },
} = require("../lib/stats.js");

const match = (id, aId, bId, aGoals, bGoals, dateMillis, aDelta = 16, bDelta = -16) => ({
  id,
  seasonId: "s1",
  aId,
  bId,
  aGoals,
  bGoals,
  dateMillis,
  aDelta,
  bDelta,
});

test("derives records, streaks, and biggest wins chronologically", () => {
  const result = deriveLeagueStats(
    [
      match("m3", "alice", "bob", 0, 1, 300),
      match("m1", "alice", "bob", 3, 0, 100),
      match("m2", "alice", "charlie", 2, 2, 200, 0, 0),
    ],
    ["alice", "bob", "charlie"],
  );
  const alice = result.players.find((player) => player.uid === "alice");

  assert.deepEqual(
    {
      w: alice.w,
      d: alice.d,
      l: alice.l,
      gf: alice.gf,
      ga: alice.ga,
      currentStreak: alice.currentStreak,
      currentStreakType: alice.currentStreakType,
      longestWin: alice.longestWin,
      longestUnbeaten: alice.longestUnbeaten,
    },
    {
      w: 1,
      d: 1,
      l: 1,
      gf: 5,
      ga: 3,
      currentStreak: 1,
      currentStreakType: "L",
      longestWin: 1,
      longestUnbeaten: 2,
    },
  );
  assert.equal(alice.biggestWin.matchId, "m1");
  assert.equal(alice.biggestWin.margin, 3);
});

test("head-to-head uses stable player ordering and recent-first meetings", () => {
  const result = deriveLeagueStats(
    [
      match("m1", "zara", "alice", 2, 1, 100, 14, -14),
      match("m2", "alice", "zara", 3, 0, 200, 17, -17),
      match("m3", "zara", "alice", 1, 1, 300, 0, 0),
    ],
    ["alice", "zara"],
  );
  const h2h = result.headToHead[0];

  assert.equal(h2h.pairKey, pairKeyFor("zara", "alice"));
  assert.equal(h2h.aId, "alice");
  assert.equal(h2h.bId, "zara");
  assert.deepEqual(
    {
      aWins: h2h.aWins,
      bWins: h2h.bWins,
      draws: h2h.draws,
      aGoals: h2h.aGoals,
      bGoals: h2h.bGoals,
    },
    { aWins: 1, bWins: 1, draws: 1, aGoals: 5, bGoals: 3 },
  );
  assert.deepEqual(
    h2h.meetings.map((meeting) => meeting.matchId),
    ["m3", "m2", "m1"],
  );
});

test("nemesis is the worst points share with at least three meetings", () => {
  const result = deriveLeagueStats(
    [
      match("b1", "alice", "bob", 0, 1, 100),
      match("b2", "alice", "bob", 0, 2, 200),
      match("b3", "alice", "bob", 1, 1, 300, 0, 0),
      match("c1", "alice", "charlie", 1, 0, 400),
      match("c2", "alice", "charlie", 0, 1, 500),
      match("c3", "alice", "charlie", 1, 1, 600, 0, 0),
    ],
    ["alice", "bob", "charlie"],
  );
  const alice = result.players.find((player) => player.uid === "alice");

  assert.deepEqual(alice.nemesis, {
    opponentId: "bob",
    wins: 0,
    draws: 1,
    losses: 2,
    games: 3,
  });
});
