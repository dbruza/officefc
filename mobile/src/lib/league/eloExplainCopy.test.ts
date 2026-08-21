import test from "node:test";
import assert from "node:assert/strict";
import { explainMatchElo } from "./eloExplainCopy";
import type { EloExplain, LeagueMatch } from "./types";

// Every fixture mirrors the shape recalcSeasonElo actually writes: deltas,
// before/after ratings and an eloExplain block that all agree with each other.
function matchFixture(overrides: Partial<LeagueMatch> = {}): LeagueMatch {
  return {
    id: "m1",
    seasonId: "s1",
    submittedBy: "alice",
    aId: "alice",
    bId: "bob",
    aTeamId: "ta",
    bTeamId: "tb",
    aTeam: "Arsenal",
    bTeam: "Brentford",
    aGoals: 1,
    bGoals: 0,
    status: "confirmed",
    source: "manual",
    date: null,
    photoPath: null,
    aEloBefore: 1500,
    aEloAfter: 1500,
    aDelta: 0,
    bEloBefore: 1500,
    bEloAfter: 1500,
    bDelta: 0,
    eloExplain: {
      aExpected: 0.5,
      bExpected: 0.5,
      perfA: 0.6667,
      perfB: 0.3333,
      aTeamAdj: 0,
      bTeamAdj: 0,
      aPremierAdj: 0,
      bPremierAdj: 0,
      aK: 32,
      bK: 32,
    },
    ...overrides,
  };
}

function explain(overrides: Partial<EloExplain> = {}): EloExplain {
  return {
    aExpected: 0.5,
    bExpected: 0.5,
    perfA: 0.6667,
    perfB: 0.3333,
    aTeamAdj: 0,
    bTeamAdj: 0,
    aPremierAdj: 0,
    bPremierAdj: 0,
    aK: 32,
    bK: 32,
    ...overrides,
  };
}

// The complaint case: equal players, 10-overall-point team gap, 1–0 win.
// Expectation ≈ performance, so the delta rounds to 0 — and the prose must say
// exactly that, in that order: why he was favoured, why the win scored low, why
// that lands on 0.
test("expected narrow win explains a 0 gain", () => {
  const match = matchFixture({
    aDelta: 0,
    bDelta: 0,
    eloExplain: explain({
      aExpected: 0.666,
      bExpected: 0.334,
      aTeamAdj: 120,
      bTeamAdj: -120,
      aK: 40,
      bK: 40,
    }),
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.deepEqual(result.a.sentences, [
    "Going in, Alex was the favourite at 67% — with a team 10 overall points stronger (about 120 ELO).",
    "A narrow 1–0 win only scores 67% on performance — a one-goal margin counts for less than the scoreline suggests.",
    "That landed almost exactly on the 67% expectation, so it rounded to 0 — nothing to gain from a win the ratings already saw coming.",
    "Moves are bigger while a rating settles — the provisional K-factor (40) applies for a player's first 10 games of a season.",
  ]);
  assert.deepEqual(result.b.sentences, [
    "Going in, Sam was the underdog at 33% — with a team 10 overall points weaker (about 120 ELO).",
    "The 0–1 loss still scores 33% on performance — losing well softens the fall.",
    "The result landed almost exactly on the 33% expectation, so it rounded to 0.",
    "Moves are bigger while a rating settles — the provisional K-factor (40) applies for a player's first 10 games of a season.",
  ]);
});

// The counter-intuitive case: the winner was heavily expected AND second-best on
// the chances, so he loses points while the beaten underdog gains them.
test("winner outshot explains a negative-on-win and points for the loser", () => {
  const match = matchFixture({
    aEloBefore: 1600,
    aEloAfter: 1595,
    aDelta: -5,
    bEloBefore: 1450,
    bEloAfter: 1455,
    bDelta: 5,
    aStats: { shotsOnTarget: 3, possession: 42 },
    bStats: { shotsOnTarget: 6, possession: 58 },
    eloExplain: explain({
      aExpected: 0.703,
      bExpected: 0.297,
      perfA: 0.547,
      perfB: 0.453,
    }),
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.deepEqual(result.a.sentences, [
    "Going in, Alex was the strong favourite at 70% — rated 1600 to Sam's 1450.",
    "A narrow 1–0 win only scores 55% on performance — a one-goal margin counts for less than the scoreline suggests.",
    "They were second-best on the chances, though (3–6 shots on target, 42% possession).",
    "The ratings expected this so strongly (70%) that even the win scored below expectation — ELO -5.",
  ]);
  assert.deepEqual(result.b.sentences, [
    "Going in, Sam was a big underdog at 30% — rated 1450 to Alex's 1600.",
    "The 0–1 loss still scores 45% on performance — losing well softens the fall.",
    "They created the better chances despite the score (6–3 shots on target, 58% possession).",
    "Even the loss came in above the 30% expectation — ELO +5.",
  ]);
});

test("underdog win reads as an upset for the winner and against the favourite", () => {
  const match = matchFixture({
    aEloBefore: 1600,
    aEloAfter: 1585,
    aDelta: -15,
    bEloBefore: 1450,
    bEloAfter: 1465,
    bDelta: 15,
    aGoals: 1,
    bGoals: 3,
    eloExplain: explain({ aExpected: 0.703, bExpected: 0.297, perfA: 0.25, perfB: 0.75 }),
  });

  const result = explainMatchElo(match, "Alex", "Bob");
  assert.ok(result);
  assert.deepEqual(result.b.sentences, [
    "Going in, Bob was a big underdog at 30% — rated 1450 to Alex's 1600.",
    "The 3–1 win scores 75% on performance.",
    "Beating a 30% expectation is a proper upset — worth +15.",
  ]);
  assert.deepEqual(result.a.sentences, [
    "Going in, Alex was the strong favourite at 70% — rated 1600 to Bob's 1450.",
    "The 1–3 loss still scores 25% on performance — losing well softens the fall.",
    "An upset in Bob's favour — ELO -15.",
  ]);
});

test("reigning premier's narrow win costs a point and the opponent gains one", () => {
  const match = matchFixture({
    aEloBefore: 1550,
    aEloAfter: 1549,
    aDelta: -1,
    bEloBefore: 1500,
    bEloAfter: 1501,
    bDelta: 1,
    eloExplain: explain({
      aExpected: 0.703,
      bExpected: 0.297,
      aPremierAdj: 100,
      bPremierAdj: -100,
    }),
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.deepEqual(result.a.sentences, [
    "Going in, Alex was the strong favourite at 70% — rated 1550 to Sam's 1500, plus 100 ELO as the reigning premier.",
    "A narrow 1–0 win only scores 67% on performance — a one-goal margin counts for less than the scoreline suggests.",
    "The ratings expected this so strongly (70%) that even the win scored below expectation — ELO -1.",
  ]);
  assert.deepEqual(result.b.sentences, [
    "Going in, Sam was a big underdog at 30% — rated 1500 to Alex's 1550, with Alex rated 100 ELO higher as the reigning premier.",
    "The 0–1 loss still scores 33% on performance — losing well softens the fall.",
    "Even the loss came in above the 30% expectation — ELO +1.",
  ]);
});

test("even draw with no drivers explains itself as a coin flip", () => {
  const match = matchFixture({
    aGoals: 2,
    bGoals: 2,
    eloExplain: explain({ aExpected: 0.5, bExpected: 0.5, perfA: 0.5, perfB: 0.5 }),
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.deepEqual(result.a.sentences, [
    "Going in, the ratings had this about 50–50 — nothing separated the two.",
    "The 2–2 draw scores 50% on performance.",
    "Dead level with expectations — ELO unchanged.",
  ]);
});

test("provisional K is noted only for the still-settling player", () => {
  const match = matchFixture({
    eloExplain: explain({ aK: 40, bK: 32 }),
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.equal(result.a.sentences.length, 4);
  assert.equal(result.b.sentences.length, 3);
});

// Shots on target and possession pointing opposite ways means there is no single
// chances story to tell — the sentence is skipped rather than hedged.
test("conflicting chance signals produce no stats sentence", () => {
  const match = matchFixture({
    aStats: { shotsOnTarget: 3, possession: 58 },
    bStats: { shotsOnTarget: 6, possession: 42 },
  });

  const result = explainMatchElo(match, "Alex", "Sam");
  assert.ok(result);
  assert.equal(result.a.sentences.length, 3);
  assert.ok(!result.a.sentences.some((s) => s.includes("chances")));
});

test("returns null without explain data, deltas, or pre-match ratings", () => {
  assert.equal(explainMatchElo(matchFixture({ eloExplain: undefined }), "Alex", "Sam"), null);
  assert.equal(explainMatchElo(matchFixture({ aDelta: null }), "Alex", "Sam"), null);
  assert.equal(explainMatchElo(matchFixture({ bEloBefore: null }), "Alex", "Sam"), null);
});
