const test = require("node:test");
const assert = require("node:assert/strict");
const { BASE_ELO, calculateSeason } = require("../lib/elo.js");

// Stats-aware ELO: the delta scales with goal margin, not just win/draw/loss.
// A 3–1 win (margin 2) gives a 0.75 performance score → round(32 * (0.75 - 0.5)) = 8.
test("equal-rated 3–1 win moves both players by 8 (goal-margin weighted)", () => {
  const result = calculateSeason(
    [
      {
        id: "m1",
        aId: "alice",
        bId: "bob",
        aGoals: 3,
        bGoals: 1,
        dateMillis: 100,
      },
    ],
    ["alice", "bob"],
    0,
  );

  assert.equal(result.matches[0].aDelta, 8);
  assert.equal(result.matches[0].bDelta, -8);
  assert.equal(result.standings[0].uid, "alice");
  assert.equal(result.standings[0].elo, 1508);
  assert.equal(result.standings[1].elo, 1492);
});

test("recalculation is chronological and excludes players without games from standings", () => {
  const result = calculateSeason(
    [
      { id: "later", aId: "alice", bId: "bob", aGoals: 0, bGoals: 1, dateMillis: 200 },
      { id: "earlier", aId: "alice", bId: "bob", aGoals: 2, bGoals: 0, dateMillis: 100 },
    ],
    ["alice", "bob", "charlie"],
    50,
  );

  assert.deepEqual(
    result.matches.map((match) => match.id),
    ["earlier", "later"],
  );
  assert.equal(result.matches[1].aEloBefore, 1508);
  assert.equal(result.standings.length, 2);
  assert.equal(result.history.charlie.length, 1);
  assert.equal(result.history.charlie[0].rating, BASE_ELO);
});

test("draws update records and preserve equal ratings", () => {
  const result = calculateSeason(
    [{ id: "draw", aId: "alice", bId: "bob", aGoals: 2, bGoals: 2, dateMillis: 100 }],
    ["alice", "bob"],
    0,
  );

  assert.equal(result.matches[0].aDelta, 0);
  assert.equal(result.matches[0].bDelta, 0);
  assert.equal(result.standings[0].d, 1);
  assert.deepEqual(result.standings[0].form, ["D"]);
});
