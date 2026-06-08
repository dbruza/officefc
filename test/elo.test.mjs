/**
 * Unit tests for the stats-aware ELO performance blend.
 * Imports the compiled JS (functions/lib/elo.js) so the same file path works
 * whether tests run before or after a source change is compiled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { performanceScore, calculateSeason, BASE_ELO, ELO_K, expectedScore } from "../functions/lib/elo.js";

// ---------------------------------------------------------------------------
// performanceScore — unit tests
// ---------------------------------------------------------------------------

test("perf: draws give exactly 0.5 with no stats", () => {
  const p = performanceScore({ aGoals: 0, bGoals: 0 });
  assert.equal(p, 0.5);
});

test("perf: win gives perf > 0.5, loss gives perf < 0.5", () => {
  const win = performanceScore({ aGoals: 2, bGoals: 0 });
  const loss = performanceScore({ aGoals: 0, bGoals: 2 });
  assert.ok(win > 0.5, `win (${win}) should be > 0.5`);
  assert.ok(loss < 0.5, `loss (${loss}) should be < 0.5`);
});

test("perf: zero-sum — perfA + perfB === 1 for any match", () => {
  const cases = [
    { aGoals: 0, bGoals: 0 },
    { aGoals: 3, bGoals: 1 },
    { aGoals: 1, bGoals: 5 },
    { aGoals: 2, bGoals: 2, aShotsOnTarget: 7, bShotsOnTarget: 3, aPossession: 60, bPossession: 40 },
    { aGoals: 1, bGoals: 2, aShotsOnTarget: 5, bShotsOnTarget: 8 },
  ];
  for (const m of cases) {
    const perfA = performanceScore(m);
    const perfB = performanceScore({ aGoals: m.bGoals, bGoals: m.aGoals, aShotsOnTarget: m.bShotsOnTarget, bShotsOnTarget: m.aShotsOnTarget, aPossession: m.bPossession, bPossession: m.aPossession });
    assert.ok(Math.abs(perfA + perfB - 1) < 1e-10, `perfA(${perfA}) + perfB(${perfB}) !== 1 for ${JSON.stringify(m)}`);
  }
});

test("perf: bigger goal margin gives higher perf (no stats)", () => {
  const p1_0 = performanceScore({ aGoals: 1, bGoals: 0 });
  const p3_0 = performanceScore({ aGoals: 3, bGoals: 0 });
  const p5_0 = performanceScore({ aGoals: 5, bGoals: 0 });
  assert.ok(p3_0 > p1_0, `3-0 (${p3_0}) should beat 1-0 (${p1_0})`);
  assert.ok(p5_0 > p3_0, `5-0 (${p5_0}) should beat 3-0 (${p3_0})`);
});

test("perf: missing stats reweights to goals-only, value in (0.5, 1) for a win", () => {
  const full = performanceScore({ aGoals: 2, bGoals: 0, aShotsOnTarget: null, bShotsOnTarget: null, aPossession: null, bPossession: null });
  const bare = performanceScore({ aGoals: 2, bGoals: 0 });
  assert.equal(full, bare, "null stats should produce same result as omitted stats");
  assert.ok(full > 0.5 && full < 1, `value ${full} should be in (0.5, 1)`);
});

test("perf: dominant draw (SOT + possession dominance) gives perf > 0.5", () => {
  const p = performanceScore({
    aGoals: 1,
    bGoals: 1,
    aShotsOnTarget: 9,
    bShotsOnTarget: 1,
    aPossession: 70,
    bPossession: 30,
  });
  assert.ok(p > 0.5, `dominant draw (${p}) should be > 0.5`);
});

test("perf: narrow loss with shot+possession dominance gives perf close to 0.5", () => {
  const p = performanceScore({
    aGoals: 0,
    bGoals: 1,
    aShotsOnTarget: 10,
    bShotsOnTarget: 1,
    aPossession: 75,
    bPossession: 25,
  });
  // Dominated but lost: perf should be nudged upward vs goals-only loss
  const pGoalsOnly = performanceScore({ aGoals: 0, bGoals: 1 });
  assert.ok(p > pGoalsOnly, `dominant narrow loss (${p}) should be higher than goals-only loss (${pGoalsOnly})`);
});

test("perf: all-zero shots-on-target provides no signal (returns null share)", () => {
  // When both sides have 0 SoT, share() returns null — falls back to goals+possession
  const withZeroSot = performanceScore({ aGoals: 2, bGoals: 0, aShotsOnTarget: 0, bShotsOnTarget: 0, aPossession: 55, bPossession: 45 });
  const withoutSot = performanceScore({ aGoals: 2, bGoals: 0, aPossession: 55, bPossession: 45 });
  assert.equal(withZeroSot, withoutSot, "zero SoT on both sides should produce same result as missing SoT");
});

// ---------------------------------------------------------------------------
// calculateSeason — integration tests
// ---------------------------------------------------------------------------

test("calculateSeason: ELO changes more for 5-0 than 1-0 (same participants, same starting ELO)", () => {
  const base = [
    { id: "m1", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 1000 },
  ];
  const big = [
    { id: "m1", aId: "p1", bId: "p2", aGoals: 5, bGoals: 0, dateMillis: 1000 },
  ];
  const r1 = calculateSeason(base, ["p1", "p2"], 0);
  const r5 = calculateSeason(big, ["p1", "p2"], 0);
  const delta1 = r1.matches[0].aDelta;
  const delta5 = r5.matches[0].aDelta;
  assert.ok(delta5 > delta1, `5-0 delta (${delta5}) should be > 1-0 delta (${delta1})`);
});

test("calculateSeason: full stats match produces different ELO than goals-only for same score", () => {
  const goalsOnly = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 2, bGoals: 1, dateMillis: 1000 }];
  const withStats = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 2, bGoals: 1, aShotsOnTarget: 8, bShotsOnTarget: 2, aPossession: 65, bPossession: 35, dateMillis: 1000 }];
  const r1 = calculateSeason(goalsOnly, ["p1", "p2"], 0);
  const r2 = calculateSeason(withStats, ["p1", "p2"], 0);
  assert.notEqual(r1.matches[0].aDelta, r2.matches[0].aDelta, "stat-influenced match should produce different delta");
});

test("calculateSeason: winner still gets positive delta, loser negative", () => {
  const matches = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 3, bGoals: 1, aShotsOnTarget: 6, bShotsOnTarget: 3, aPossession: 55, bPossession: 45, dateMillis: 1000 }];
  const r = calculateSeason(matches, ["p1", "p2"], 0);
  assert.ok(r.matches[0].aDelta > 0, "winner should gain ELO");
  assert.ok(r.matches[0].bDelta < 0, "loser should lose ELO");
  assert.equal(r.standings[0].uid, "p1", "winner should rank first");
});

test("calculateSeason: ELO deltas are symmetric (aDelta + bDelta ≈ 0)", () => {
  const matches = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 2, bGoals: 2, aShotsOnTarget: 5, bShotsOnTarget: 5, aPossession: 50, bPossession: 50, dateMillis: 1000 }];
  const r = calculateSeason(matches, ["p1", "p2"], 0);
  // Both players start at BASE_ELO so expected score is 0.5.
  // Symmetric match → both deltas should be 0 (or ±1 due to rounding)
  assert.ok(Math.abs(r.matches[0].aDelta + r.matches[0].bDelta) <= 1, "sum of deltas should be ≈ 0");
});
