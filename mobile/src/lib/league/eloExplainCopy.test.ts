import test from "node:test";
import assert from "node:assert/strict";
import { explainMatchEloParagraph } from "./eloExplainCopy";
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
// Expectation ≈ performance, so the delta rounds to 0 — the paragraph must say
// exactly that, in order: why he was favoured, why the win scored low, why
// that lands on 0. One paragraph, no per-player mirror of the same wording.
test("expected narrow win explains a 0 gain in one paragraph", () => {
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

  const result = explainMatchEloParagraph(match, "Alex", "Sam");
  assert.ok(result);
  assert.equal(
    result,
    "Going in, Alex was the favourite at 67% — with a team 10 overall points stronger (about 120 ELO). " +
      "Alex's narrow 1–0 win only scores 67% on performance — a one-goal margin counts for less than the scoreline suggests. " +
      "Both results landed almost exactly on expectation (67%), so the moves rounded to 0. " +
      "Moves are bigger while a rating settles — the provisional K-factor applies for a player's first 10 games of a season.",
  );
});

// The counter-intuitive case: the winner was heavily expected AND second-best on
// the chances, so they lose points while the beaten underdog gains them.
test("winner outshot explains negative-on-win in one paragraph", () => {
  const match = matchFixture({
    aEloBefore: 1600,
    aEloAfter: 1595,
    aDelta: -5,
    bEloBefore: 1450,
    bEloAfter: 1455,
    bDelta: 5,
    aStats: { xg: 0.7, possession: 42 },
    bStats: { xg: 2.1, possession: 58 },
    eloExplain: explain({
      aExpected: 0.703,
      bExpected: 0.297,
      perfA: 0.547,
      perfB: 0.453,
    }),
  });

  const result = explainMatchEloParagraph(match, "Alex", "Sam");
  assert.ok(result);
  assert.equal(
    result,
    "Going in, Alex was the strong favourite at 70% — rated 1600 to Sam's 1450. " +
      "Alex's narrow 1–0 win only scores 55% on performance — a one-goal margin counts for less than the scoreline suggests. " +
      "The chances told a different story (0.7–2.1 xG, 42% possession). " +
      "The ratings expected this so strongly (70%) that even the win scored below expectation — Alex -5, Sam +5.",
  );
});

// The B-side upset: winner is B, so every sentence must flip to B's perspective
// without quoting mirrored numbers from A's side of the ledger. A two-goal
// margin is not "narrow" prose; the upset line carries the story.
test("underdog two-goal win reads as a plain upset from B's side", () => {
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

  const result = explainMatchEloParagraph(match, "Alex", "Bob");
  assert.ok(result);
  assert.ok(!result.includes("narrow"), `should not call a 2-goal win narrow: ${result}`);
  assert.equal(
    result,
    "Going in, Alex was the strong favourite at 70% — rated 1600 to Bob's 1450. " +
      "The win gives Bob 75% of the performance. " +
      "Beating a 30% expectation is a proper upset — Bob +15, Alex -15.",
  );
});

// Reigning-premier handicap shows up once, attached to the favourite.
test("premier handicap appears once in the expectation sentence", () => {
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
      perfA: 0.6667,
      perfB: 0.3333,
    }),
  });

  const result = explainMatchEloParagraph(match, "Alex", "Sam");
  assert.ok(result);
  assert.match(result, /plus 100 ELO as the reigning premier/);
  assert.equal((result.match(/reigning premier/g) ?? []).length, 1);
  assert.ok(
    result.endsWith(
      "The ratings expected this so strongly (70%) that even the win scored below expectation — Alex -1, Sam +1.",
    ),
  );
});

// Even draw, no drivers: the coin-flip framing plus a split performance share.
test("even draw reads as a coin flip", () => {
  const match = matchFixture({
    aGoals: 2,
    bGoals: 2,
    eloExplain: explain({ aExpected: 0.5, bExpected: 0.5, perfA: 0.5, perfB: 0.5 }),
  });

  const result = explainMatchEloParagraph(match, "Alex", "Sam");
  assert.ok(result);
  assert.equal(
    result,
    "Going in, the ratings had this about 50–50 — nothing separated the two. " +
      "The draw splits the performance 50%/50%. Dead level with expectations — ELO unchanged.",
  );
});

// xG and possession pointing opposite ways means there is no single chances
// story to tell — the sentence is skipped rather than hedged.
test("conflicting chance signals produce no stats sentence", () => {
  const match = matchFixture({
    aStats: { xg: 0.8, possession: 58 },
    bStats: { xg: 2.2, possession: 42 },
  });

  const result = explainMatchEloParagraph(match, "Alex", "Sam");
  assert.ok(result);
  assert.ok(!result.includes("chances"));
});

// Provisional K is noted only when at least one player is still settling.
test("provisional K note appears when either K is elevated", () => {
  const standard = matchFixture();
  const plain = explainMatchEloParagraph(standard, "Alex", "Sam");
  assert.ok(plain);
  assert.ok(!plain.includes("provisional"));

  const provisional = matchFixture({ eloExplain: explain({ aK: 40 }) });
  const withProvisional = explainMatchEloParagraph(provisional, "Alex", "Sam");
  assert.ok(withProvisional);
  assert.ok(withProvisional.includes("provisional K-factor"));
});

test("returns null without explain data, deltas, or pre-match ratings", () => {
  assert.equal(
    explainMatchEloParagraph(matchFixture({ eloExplain: undefined }), "Alex", "Sam"),
    null,
  );
  assert.equal(explainMatchEloParagraph(matchFixture({ aDelta: null }), "Alex", "Sam"), null);
  assert.equal(explainMatchEloParagraph(matchFixture({ bEloBefore: null }), "Alex", "Sam"), null);
});
