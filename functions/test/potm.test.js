const test = require("node:test");
const assert = require("node:assert/strict");
const { computePOTM } = require("../lib/elo.js");

// Mid-month timestamps so the local-time month bucket can't drift across a boundary.
const JAN = Date.UTC(2026, 0, 15);
const FEB = Date.UTC(2026, 1, 15);

// A 3–1 win for `winner` over `loser` at the given time.
function win(id, winner, loser, ms) {
  return { id, aId: winner, bId: loser, aGoals: 3, bGoals: 1, dateMillis: ms };
}

test("player of the month is whoever gained the most ELO (min 3 games)", () => {
  const potm = computePOTM([
    win("m1", "alice", "bob", JAN + 1),
    win("m2", "alice", "bob", JAN + 2),
    win("m3", "alice", "bob", JAN + 3),
  ]);

  assert.equal(potm.length, 1);
  assert.equal(potm[0].month, "2026-01");
  assert.equal(potm[0].playerId, "alice");
  assert.equal(potm[0].games, 3);
  assert.ok(potm[0].gain > 0);
});

test("a month with fewer than three games per player has no POTM", () => {
  const potm = computePOTM([
    win("m1", "alice", "bob", JAN + 1),
    win("m2", "alice", "bob", JAN + 2),
  ]);

  assert.deepEqual(potm, []);
});

test("each calendar month is scored independently", () => {
  const potm = computePOTM([
    win("j1", "alice", "bob", JAN + 1),
    win("j2", "alice", "bob", JAN + 2),
    win("j3", "alice", "bob", JAN + 3),
    win("f1", "bob", "alice", FEB + 1),
    win("f2", "bob", "alice", FEB + 2),
    win("f3", "bob", "alice", FEB + 3),
  ]);

  const winnerByMonth = Object.fromEntries(potm.map((p) => [p.month, p.playerId]));
  assert.equal(winnerByMonth["2026-01"], "alice");
  assert.equal(winnerByMonth["2026-02"], "bob");
});
