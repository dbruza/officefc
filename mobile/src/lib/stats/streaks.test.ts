import test from "node:test";
import assert from "node:assert/strict";
import {
  activeStreak,
  currentWinStreak,
  currentWinlessRun,
  longestWinStreak,
  longestWinlessRun,
  playerResults,
  type StreakMatch,
} from "./streaks";

const ALICE = "alice";
const BOB = "bob";

/** Chronological helper: match i of a season, played `i` days after the epoch base. */
function match(
  i: number,
  aId: string,
  bId: string,
  aGoals: number,
  bGoals: number,
  extra: Partial<StreakMatch> = {},
): StreakMatch {
  return { aId, bId, aGoals, bGoals, date: Date.UTC(2026, 0, 1 + i), ...extra };
}

test("playerResults returns an empty form for an unknown player or empty input", () => {
  assert.deepEqual(playerResults(ALICE, []), []);
  const only = [match(0, BOB, "carol", 2, 1)];
  assert.deepEqual(playerResults(ALICE, only), []);
});

test("currentWinStreak is zero with no games or when the latest game was not a win", () => {
  assert.equal(currentWinStreak(ALICE, []), 0);
  const lostLast = [match(0, ALICE, BOB, 2, 0), match(1, ALICE, BOB, 0, 1)];
  assert.equal(currentWinStreak(ALICE, lostLast), 0);
  const drewLast = [match(0, ALICE, BOB, 2, 0), match(1, BOB, ALICE, 1, 1)];
  assert.equal(currentWinStreak(ALICE, drewLast), 0);
});

test("all-wins inputs give full-length win and winless numbers", () => {
  const wins = [match(0, ALICE, BOB, 3, 1), match(1, BOB, ALICE, 0, 2), match(2, ALICE, BOB, 1, 0)];
  assert.equal(currentWinStreak(ALICE, wins), 3);
  assert.equal(longestWinStreak(ALICE, wins), 3);
  assert.equal(currentWinlessRun(ALICE, wins), 0);
  assert.equal(longestWinlessRun(ALICE, wins), 0);
});

test("a draw breaks a win streak exactly like a loss does", () => {
  const viaDraw = [
    match(0, ALICE, BOB, 2, 0),
    match(1, ALICE, BOB, 1, 1), // draw ends the run
    match(2, ALICE, BOB, 4, 0),
  ];
  const viaLoss = [
    match(0, ALICE, BOB, 2, 0),
    match(1, BOB, ALICE, 3, 2), // loss ends the run
    match(2, ALICE, BOB, 4, 0),
  ];
  for (const games of [viaDraw, viaLoss]) {
    assert.equal(longestWinStreak(ALICE, games), 1, "no result may bridge over D or L");
    assert.equal(currentWinStreak(ALICE, games), 1);
  }
});

test("currentWinlessRun counts draws and losses alike since the last win", () => {
  const drawThenLoss = [
    match(0, ALICE, BOB, 2, 1), // last win
    match(1, ALICE, BOB, 1, 1), // draw still winless
    match(2, BOB, ALICE, 2, 0), // loss still winless
  ];
  assert.equal(currentWinlessRun(ALICE, drawThenLoss), 2);
  assert.equal(longestWinlessRun(ALICE, drawThenLoss), 2);
});

test("longestWinlessRun remembers a worse past run even after returning to winning", () => {
  const recovered = [
    match(0, BOB, ALICE, 1, 0), // L
    match(1, ALICE, BOB, 1, 1), // D
    match(2, ALICE, BOB, 5, 0), // W
    match(3, ALICE, BOB, 2, 0), // W
  ];
  assert.equal(longestWinlessRun(ALICE, recovered), 2);
  assert.equal(currentWinlessRun(ALICE, recovered), 0);
});

test("a player who never won is winless for every game played", () => {
  const noWins = [match(0, ALICE, BOB, 0, 0), match(1, BOB, ALICE, 2, 1)];
  assert.equal(currentWinlessRun(ALICE, noWins), 2);
  assert.equal(longestWinlessRun(ALICE, noWins), 2);
  assert.equal(longestWinStreak(ALICE, noWins), 0);
});

test("finals matches are excluded by default and included only when asked", () => {
  // Alice has won her two league games; the final she lost must not touch either number.
  const season = [
    match(0, ALICE, BOB, 2, 0),
    match(1, ALICE, BOB, 3, 1),
    match(2, ALICE, BOB, 0, 4, { finals: true }),
  ];
  assert.equal(currentWinStreak(ALICE, season), 2);
  assert.equal(currentWinlessRun(ALICE, season), 0);
  assert.deepEqual(playerResults(ALICE, season), ["W", "W"]);

  assert.equal(currentWinStreak(ALICE, season, { includeFinals: true }), 0);
  assert.equal(currentWinlessRun(ALICE, season, { includeFinals: true }), 1);
  assert.deepEqual(playerResults(ALICE, season, { includeFinals: true }), ["W", "W", "L"]);
});

test("matches are sorted oldest to newest by date regardless of input order", () => {
  // Newest-first input: without sorting, the "latest" game would be the round-0 win
  // and both streaks would read wrong.
  const newestFirst = [
    match(3, BOB, ALICE, 2, 0), // L
    match(2, ALICE, BOB, 1, 0), // W
    match(1, ALICE, BOB, 1, 0), // W
    match(0, ALICE, BOB, 2, 1), // W
  ];
  assert.deepEqual(playerResults(ALICE, newestFirst), ["W", "W", "W", "L"]);
  assert.equal(currentWinStreak(ALICE, newestFirst), 0);
  assert.equal(currentWinlessRun(ALICE, newestFirst), 1);
  assert.equal(longestWinStreak(ALICE, newestFirst), 3);
});

test("activeStreak pins most-recent-last form order", () => {
  assert.equal(activeStreak([]), null);
  // Same two results, opposite orders — only oldest→newest makes these differ.
  assert.deepEqual(activeStreak(["L", "W"]), { type: "W", length: 1 });
  assert.deepEqual(activeStreak(["W", "L"]), { type: "L", length: 1 });
  assert.deepEqual(activeStreak(["D", "W", "W", "L", "L"]), { type: "L", length: 2 });
  assert.deepEqual(activeStreak(["W", "D", "D"]), { type: "D", length: 2 });
});

test("undated matches are trusted in the order given instead of half-sorted", () => {
  const undated = [
    { aId: ALICE, bId: BOB, aGoals: 1, bGoals: 0 }, // W (caller says this is latest)
    { aId: ALICE, bId: BOB, aGoals: 0, bGoals: 2, date: null }, // older L
  ];
  assert.deepEqual(playerResults(ALICE, undated), ["W", "L"]);
  assert.equal(currentWinStreak(ALICE, undated), 0);
});

test("per-player accounting reads each side of the fixture correctly", () => {
  const games = [
    match(0, ALICE, BOB, 2, 1), // Alice W, Bob L
    match(1, BOB, ALICE, 3, 3), // Bob D (home), Alice D (away)
  ];
  assert.deepEqual(playerResults(ALICE, games), ["W", "D"]);
  assert.deepEqual(playerResults(BOB, games), ["L", "D"]);
  assert.equal(currentWinlessRun(BOB, games), 2);
});
