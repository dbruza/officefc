const test = require("node:test");
const assert = require("node:assert/strict");
const { BASE_ELO, calculateSeason } = require("../lib/elo.js");

// Stats-aware ELO: the delta scales with goal margin, not just win/draw/loss.
// A 3–1 win (margin 2) gives a 0.75 performance score. Both players are on their first game,
// so the provisional K (40) applies → round(40 * (0.75 - 0.5)) = 10.
test("equal-rated 3–1 win moves both players by 10 (goal-margin weighted, provisional K)", () => {
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

  assert.equal(result.matches[0].aDelta, 10);
  assert.equal(result.matches[0].bDelta, -10);
  assert.equal(result.standings[0].uid, "alice");
  assert.equal(result.standings[0].elo, 1510);
  assert.equal(result.standings[1].elo, 1490);
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
  // "earlier" (2–0, perf 0.75) on the provisional K (40): alice 1500 → 1510 before "later".
  assert.equal(result.matches[1].aEloBefore, 1510);
  assert.equal(result.standings.length, 2);
  assert.equal(result.history.charlie.length, 1);
  assert.equal(result.history.charlie[0].rating, BASE_ELO);
});

// Team-strength handicap: team overall is folded into the expected score at
// TEAM_ELO_PER_OVERALL (12) Elo per overall point. With equal player Elo, a 3–1 win
// (perf 0.75) by the weaker team beats a stronger expectation, so the underdog gains more.
// gap = 85 - 70 = 15 overall → 180 effective Elo → expected ≈ 0.262. On the provisional K (40):
// round(40*(0.75-0.262)) = 20.
test("underdog team winning earns more than the neutral move", () => {
  const result = calculateSeason(
    [
      {
        id: "m1",
        aId: "alice",
        bId: "bob",
        aGoals: 3,
        bGoals: 1,
        dateMillis: 100,
        aTeamOverall: 70,
        bTeamOverall: 85,
      },
    ],
    ["alice", "bob"],
    0,
  );

  assert.equal(result.matches[0].aDelta, 20);
  assert.equal(result.matches[0].bDelta, -20);
});

// Same 3–1 win but the favourite team wins: expectation ≈ 0.738 → round(40*(0.75-0.738)) = 0.
// At this strength a heavy favourite gains nothing from a routine win, even on the provisional K.
test("favourite team winning earns less than the neutral move", () => {
  const result = calculateSeason(
    [
      {
        id: "m1",
        aId: "alice",
        bId: "bob",
        aGoals: 3,
        bGoals: 1,
        dateMillis: 100,
        aTeamOverall: 85,
        bTeamOverall: 70,
      },
    ],
    ["alice", "bob"],
    0,
  );

  assert.equal(result.matches[0].aDelta, 0);
  // Math.round(-0.38) is -0; compare with == semantics rather than Object.is.
  assert.equal(result.matches[0].bDelta === 0, true);
});

// If either team's overall is missing, no handicap applies — identical to the neutral 10.
test("missing team overall falls back to no handicap", () => {
  const result = calculateSeason(
    [
      {
        id: "m1",
        aId: "alice",
        bId: "bob",
        aGoals: 3,
        bGoals: 1,
        dateMillis: 100,
        aTeamOverall: 70,
        bTeamOverall: null,
      },
    ],
    ["alice", "bob"],
    0,
  );

  assert.equal(result.matches[0].aDelta, 10);
  assert.equal(result.matches[0].bDelta, -10);
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
