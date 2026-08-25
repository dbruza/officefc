/**
 * Unit tests for the stats-aware ELO performance blend.
 * Imports the compiled JS (functions/lib/elo.js) so the same file path works
 * whether tests run before or after a source change is compiled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  performanceScore,
  calculateSeason,
  getK,
  compareStandings,
  expectedScore,
  PREMIER_HANDICAP_ELO,
} from "../functions/lib/elo.js";

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
    {
      aGoals: 2,
      bGoals: 2,
      aXg: 2.4,
      bXg: 0.9,
      aPossession: 60,
      bPossession: 40,
    },
    { aGoals: 1, bGoals: 2, aXg: 1.1, bXg: 3.2 },
  ];
  for (const m of cases) {
    const perfA = performanceScore(m);
    const perfB = performanceScore({
      aGoals: m.bGoals,
      bGoals: m.aGoals,
      aXg: m.bXg,
      bXg: m.aXg,
      aPossession: m.bPossession,
      bPossession: m.aPossession,
    });
    assert.ok(
      Math.abs(perfA + perfB - 1) < 1e-10,
      `perfA(${perfA}) + perfB(${perfB}) !== 1 for ${JSON.stringify(m)}`,
    );
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
  const full = performanceScore({
    aGoals: 2,
    bGoals: 0,
    aXg: null,
    bXg: null,
    aPossession: null,
    bPossession: null,
  });
  const bare = performanceScore({ aGoals: 2, bGoals: 0 });
  assert.equal(full, bare, "null stats should produce same result as omitted stats");
  assert.ok(full > 0.5 && full < 1, `value ${full} should be in (0.5, 1)`);
});

test("perf: dominant draw (xG + possession dominance) gives perf > 0.5", () => {
  const p = performanceScore({
    aGoals: 1,
    bGoals: 1,
    aXg: 3.6,
    bXg: 0.4,
    aPossession: 70,
    bPossession: 30,
  });
  assert.ok(p > 0.5, `dominant draw (${p}) should be > 0.5`);
});

test("perf: narrow loss with shot+possession dominance gives perf close to 0.5", () => {
  const p = performanceScore({
    aGoals: 0,
    bGoals: 1,
    aXg: 4.1,
    bXg: 0.4,
    aPossession: 75,
    bPossession: 25,
  });
  // Dominated but lost: perf should be nudged upward vs goals-only loss
  const pGoalsOnly = performanceScore({ aGoals: 0, bGoals: 1 });
  assert.ok(
    p > pGoalsOnly,
    `dominant narrow loss (${p}) should be higher than goals-only loss (${pGoalsOnly})`,
  );
});

test("perf: all-zero shots-on-target provides no signal (returns null share)", () => {
  // When both sides have 0 xG, share() returns null — falls back to goals+possession
  const withZeroSot = performanceScore({
    aGoals: 2,
    bGoals: 0,
    aXg: 0,
    bXg: 0,
    aPossession: 55,
    bPossession: 45,
  });
  const withoutSot = performanceScore({ aGoals: 2, bGoals: 0, aPossession: 55, bPossession: 45 });
  assert.equal(
    withZeroSot,
    withoutSot,
    "zero SoT on both sides should produce same result as missing xG",
  );
});

// ---------------------------------------------------------------------------
// calculateSeason — integration tests
// ---------------------------------------------------------------------------

test("calculateSeason: ELO changes more for 5-0 than 1-0 (same participants, same starting ELO)", () => {
  const base = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 1000 }];
  const big = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 5, bGoals: 0, dateMillis: 1000 }];
  const r1 = calculateSeason(base, ["p1", "p2"], 0);
  const r5 = calculateSeason(big, ["p1", "p2"], 0);
  const delta1 = r1.matches[0].aDelta;
  const delta5 = r5.matches[0].aDelta;
  assert.ok(delta5 > delta1, `5-0 delta (${delta5}) should be > 1-0 delta (${delta1})`);
});

test("calculateSeason: full stats match produces different ELO than goals-only for same score", () => {
  const goalsOnly = [{ id: "m1", aId: "p1", bId: "p2", aGoals: 2, bGoals: 1, dateMillis: 1000 }];
  const withStats = [
    {
      id: "m1",
      aId: "p1",
      bId: "p2",
      aGoals: 2,
      bGoals: 1,
      aXg: 2.9,
      bXg: 0.7,
      aPossession: 65,
      bPossession: 35,
      dateMillis: 1000,
    },
  ];
  const r1 = calculateSeason(goalsOnly, ["p1", "p2"], 0);
  const r2 = calculateSeason(withStats, ["p1", "p2"], 0);
  assert.notEqual(
    r1.matches[0].aDelta,
    r2.matches[0].aDelta,
    "stat-influenced match should produce different delta",
  );
});

test("calculateSeason: winner still gets positive delta, loser negative", () => {
  const matches = [
    {
      id: "m1",
      aId: "p1",
      bId: "p2",
      aGoals: 3,
      bGoals: 1,
      aXg: 2.1,
      bXg: 0.9,
      aPossession: 55,
      bPossession: 45,
      dateMillis: 1000,
    },
  ];
  const r = calculateSeason(matches, ["p1", "p2"], 0);
  assert.ok(r.matches[0].aDelta > 0, "winner should gain ELO");
  assert.ok(r.matches[0].bDelta < 0, "loser should lose ELO");
  assert.equal(r.standings[0].uid, "p1", "winner should rank first");
});

test("calculateSeason: ELO deltas are symmetric (aDelta + bDelta ≈ 0)", () => {
  const matches = [
    {
      id: "m1",
      aId: "p1",
      bId: "p2",
      aGoals: 2,
      bGoals: 2,
      aXg: 1.4,
      bXg: 1.4,
      aPossession: 50,
      bPossession: 50,
      dateMillis: 1000,
    },
  ];
  const r = calculateSeason(matches, ["p1", "p2"], 0);
  // Both players start at BASE_ELO so expected score is 0.5.
  // Symmetric match → both deltas should be 0 (or ±1 due to rounding)
  assert.ok(
    Math.abs(r.matches[0].aDelta + r.matches[0].bDelta) <= 1,
    "sum of deltas should be ≈ 0",
  );
});

// ---------------------------------------------------------------------------
// D1 — minimum ranked games (eligibility)
// ---------------------------------------------------------------------------

// p1 plays 4 games, p2 plays 3, p3 plays 1 → p3 is provisional (< MIN_RANKED_GAMES).
const D1_MATCHES = [
  { id: "m1", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 1000 },
  { id: "m2", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 2000 },
  { id: "m3", aId: "p1", bId: "p2", aGoals: 0, bGoals: 1, dateMillis: 3000 },
  { id: "m4", aId: "p1", bId: "p3", aGoals: 2, bGoals: 1, dateMillis: 4000 },
];

test("calculateSeason: a player with fewer than MIN_RANKED_GAMES is provisional", () => {
  const r = calculateSeason(D1_MATCHES, ["p1", "p2", "p3"], 0);
  const byId = Object.fromEntries(r.standings.map((s) => [s.uid, s]));
  assert.equal(byId.p1.ranked, true, "p1 (4 games) is ranked");
  assert.equal(byId.p2.ranked, true, "p2 (3 games) is ranked");
  assert.equal(byId.p3.ranked, false, "p3 (1 game) is provisional");
  assert.equal(byId.p3.rank, 0, "provisional player has no rank number");
});

test("calculateSeason: ranked players get sequential ranks, provisional excluded from numbering", () => {
  const r = calculateSeason(D1_MATCHES, ["p1", "p2", "p3"], 0);
  const rankedRanks = r.standings
    .filter((s) => s.ranked)
    .map((s) => s.rank)
    .sort((a, b) => a - b);
  assert.deepEqual(rankedRanks, [1, 2], "exactly two ranked players, ranks 1 and 2");
});

test("calculateSeason: a member with zero games is absent from standings", () => {
  const r = calculateSeason(D1_MATCHES, ["p1", "p2", "p3", "p4"], 0);
  assert.ok(!r.standings.some((s) => s.uid === "p4"), "zero-game member excluded entirely");
});

// ---------------------------------------------------------------------------
// D2 — tie-break chain (compareStandings)
// ---------------------------------------------------------------------------

function mkStanding(overrides) {
  return {
    uid: "u",
    rank: 0,
    elo: 1500,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    form: [],
    move: 0,
    ranked: true,
    ...overrides,
  };
}

test("compareStandings: higher ELO ranks first", () => {
  assert.ok(compareStandings(mkStanding({ elo: 1600 }), mkStanding({ elo: 1500 })) < 0);
});

test("compareStandings: equal ELO broken by goal difference", () => {
  const a = mkStanding({ elo: 1500, gf: 10, ga: 2 }); // GD +8
  const b = mkStanding({ elo: 1500, gf: 10, ga: 9 }); // GD +1
  assert.ok(compareStandings(a, b) < 0, "better goal difference sorts first");
});

test("compareStandings: equal ELO and GD broken by wins", () => {
  const a = mkStanding({ elo: 1500, gf: 5, ga: 5, w: 4 });
  const b = mkStanding({ elo: 1500, gf: 5, ga: 5, w: 2 });
  assert.ok(compareStandings(a, b) < 0, "more wins sorts first");
});

test("compareStandings: equal ELO/GD/wins broken by fewer games played", () => {
  const a = mkStanding({ elo: 1500, gf: 5, ga: 5, w: 3, d: 0, l: 1 }); // 4 games
  const b = mkStanding({ elo: 1500, gf: 5, ga: 5, w: 3, d: 0, l: 4 }); // 7 games
  assert.ok(compareStandings(a, b) < 0, "fewer games sorts first");
});

test("compareStandings: fully tied rows broken by uid", () => {
  const a = mkStanding({ uid: "aaa", elo: 1500, gf: 5, ga: 5, w: 3, d: 0, l: 1 });
  const b = mkStanding({ uid: "bbb", elo: 1500, gf: 5, ga: 5, w: 3, d: 0, l: 1 });
  assert.ok(compareStandings(a, b) < 0, "lexically lower uid sorts first");
});

// ---------------------------------------------------------------------------
// D3 — provisional / dynamic K-factor
// ---------------------------------------------------------------------------

test("getK: provisional K (40) for first 10 games, settled K (32) thereafter", () => {
  assert.equal(getK(0), 40);
  assert.equal(getK(9), 40);
  assert.equal(getK(10), 32);
  assert.equal(getK(11), 32);
});

test("calculateSeason: a player's first game uses provisional K (40)", () => {
  const r = calculateSeason(
    [{ id: "m1", aId: "p1", bId: "p2", aGoals: 5, bGoals: 0, dateMillis: 1000 }],
    ["p1", "p2"],
    0,
  );
  const m = r.matches[0];
  const k40 = Math.round(40 * (performanceScore(m) - expectedScore(m.aEloBefore, m.bEloBefore)));
  const k32 = Math.round(32 * (performanceScore(m) - expectedScore(m.aEloBefore, m.bEloBefore)));
  assert.equal(m.aDelta, k40, "first-game delta uses K=40");
  assert.notEqual(m.aDelta, k32, "K=40 delta differs from the K=32 delta");
});

test("calculateSeason: an established player's 11th game uses settled K (32)", () => {
  const matches = [];
  for (let i = 0; i < 11; i++) {
    matches.push({
      id: `m${String(i).padStart(2, "0")}`,
      aId: "p1",
      bId: "p2",
      aGoals: i % 2 === 0 ? 1 : 0,
      bGoals: i % 2 === 0 ? 0 : 1,
      dateMillis: 1000 * (i + 1),
    });
  }
  const r = calculateSeason(matches, ["p1", "p2"], 0);
  const last = r.matches[10]; // both players have 10 prior games here
  const k32 = Math.round(
    32 * (performanceScore(last) - expectedScore(last.aEloBefore, last.bEloBefore)),
  );
  const k40 = Math.round(
    40 * (performanceScore(last) - expectedScore(last.aEloBefore, last.bEloBefore)),
  );
  assert.equal(last.aDelta, k32, "11th-game delta uses K=32");
  assert.notEqual(last.aDelta, k40, "settled K differs from provisional K");
});

// ---------------------------------------------------------------------------
// D4 — eloExplain ("why did my ELO change?")
// ---------------------------------------------------------------------------

test("calculateSeason: emits eloExplain with expected, perf, team handicap, and K per side", () => {
  const r = calculateSeason(
    [{ id: "m1", aId: "p1", bId: "p2", aGoals: 2, bGoals: 1, dateMillis: 1000 }],
    ["p1", "p2"],
    0,
  );
  const ex = r.matches[0].eloExplain;
  assert.ok(ex, "eloExplain present on the calculated match");
  assert.equal(ex.aExpected, expectedScore(1500, 1500), "expected score with no handicap");
  assert.equal(ex.bExpected, expectedScore(1500, 1500));
  assert.equal(ex.perfA, performanceScore(r.matches[0]), "perfA matches performanceScore");
  assert.ok(Math.abs(ex.perfA + ex.perfB - 1) < 1e-10, "perfA + perfB === 1");
  assert.equal(ex.aTeamAdj, 0, "no team handicap without team overalls");
  assert.equal(ex.bTeamAdj, 0);
  assert.equal(ex.aK, 40, "first game uses provisional K");
  assert.equal(ex.bK, 40);
});

test("calculateSeason: eloExplain reports the net team-strength handicap per side", () => {
  const r = calculateSeason(
    [
      {
        id: "m1",
        aId: "p1",
        bId: "p2",
        aGoals: 1,
        bGoals: 1,
        dateMillis: 1000,
        aTeamOverall: 80,
        bTeamOverall: 85,
      },
    ],
    ["p1", "p2"],
    0,
  );
  const ex = r.matches[0].eloExplain;
  // TEAM_ELO_PER_OVERALL = 12; net handicap on A = 12 * (aOvr - bOvr).
  assert.equal(ex.aTeamAdj, 12 * (80 - 85), "A had the weaker team → negative handicap");
  assert.equal(ex.bTeamAdj, 12 * (85 - 80), "B had the stronger team → positive handicap");
});

// ---------------------------------------------------------------------------
// Integrity invariants — regression guards for D1/D3 (no current code defect)
// ---------------------------------------------------------------------------

test("calculateSeason: each side's K is independent (established opponent vs a newcomer)", () => {
  // Player A racks up 10 games against fillers (→ settled K=32), then meets newcomer B (→ K=40).
  const matches = [];
  const members = ["A", "B"];
  for (let i = 0; i < 10; i++) {
    const filler = `f${i}`;
    members.push(filler);
    matches.push({
      id: `f${i}`,
      aId: "A",
      bId: filler,
      aGoals: 1,
      bGoals: 0,
      dateMillis: 1000 * (i + 1),
    });
  }
  matches.push({ id: "AB", aId: "A", bId: "B", aGoals: 1, bGoals: 0, dateMillis: 100000 });
  const r = calculateSeason(matches, members, 0);
  const ab = r.matches.find((m) => m.id === "AB");
  assert.equal(ab.eloExplain.aK, 32, "A (10 prior games) uses the settled K");
  assert.equal(ab.eloExplain.bK, 40, "B (first game) uses the provisional K");
  const expectA = Math.round(
    32 * (performanceScore(ab) - expectedScore(ab.aEloBefore, ab.bEloBefore)),
  );
  const expectB = Math.round(
    40 * (1 - performanceScore(ab) - expectedScore(ab.bEloBefore, ab.aEloBefore)),
  );
  assert.equal(ab.aDelta, expectA, "A delta computed with K=32");
  assert.equal(ab.bDelta, expectB, "B delta computed with K=40");
});

test("calculateSeason: a season where everyone is sub-threshold yields zero ranked standings", () => {
  const matches = [
    { id: "m1", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 1000 },
    { id: "m2", aId: "p3", bId: "p4", aGoals: 2, bGoals: 1, dateMillis: 2000 },
  ];
  const r = calculateSeason(matches, ["p1", "p2", "p3", "p4"], 0);
  assert.ok(r.standings.length > 0, "players with at least one game still appear");
  assert.ok(
    r.standings.every((s) => !s.ranked),
    "nobody reaches MIN_RANKED_GAMES → all provisional",
  );
  assert.ok(
    r.standings.every((s) => s.rank === 0),
    "no rank numbers are assigned",
  );
});

test("calculateSeason: provisional players always sort behind ranked players, even after a win", () => {
  // p1 & p2 play 3+ games (ranked); p3 wins its single game and stays provisional.
  const matches = [
    { id: "m1", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 1000 },
    { id: "m2", aId: "p1", bId: "p2", aGoals: 1, bGoals: 0, dateMillis: 2000 },
    { id: "m3", aId: "p2", bId: "p1", aGoals: 1, bGoals: 0, dateMillis: 3000 },
    { id: "m4", aId: "p3", bId: "p1", aGoals: 5, bGoals: 0, dateMillis: 4000 },
  ];
  const r = calculateSeason(matches, ["p1", "p2", "p3"], 0);
  const byId = Object.fromEntries(r.standings.map((s) => [s.uid, s]));
  assert.equal(byId.p3.ranked, false, "p3 (1 game) is provisional");
  assert.equal(byId.p3.rank, 0, "a provisional player holds no rank even after a win");
  const lastRanked = r.standings.map((s) => s.ranked).lastIndexOf(true);
  const firstProvisional = r.standings.findIndex((s) => !s.ranked);
  assert.ok(lastRanked < firstProvisional, "all ranked players precede any provisional player");
});

test("calculateSeason: standings carry the goal/win fields the tie-break consumes", () => {
  // p1: m1 1-0, m2 1-0, m3 0-1, m4 2-1 → gf 4, ga 2, w 3, l 1.
  const r = calculateSeason(D1_MATCHES, ["p1", "p2", "p3"], 0);
  const p1 = r.standings.find((s) => s.uid === "p1");
  assert.equal(p1.gf, 4, "goals-for wired through");
  assert.equal(p1.ga, 2, "goals-against wired through (not swapped)");
  assert.equal(p1.w, 3, "wins wired through");
  assert.equal(p1.l, 1, "losses wired through");
});

test("calculateSeason: same-millisecond matches order deterministically by id, regardless of input order", () => {
  const reversed = [
    { id: "m2", aId: "p1", bId: "p2", aGoals: 0, bGoals: 3, dateMillis: 1000 },
    { id: "m1", aId: "p1", bId: "p2", aGoals: 3, bGoals: 0, dateMillis: 1000 },
  ];
  const sorted = [
    { id: "m1", aId: "p1", bId: "p2", aGoals: 3, bGoals: 0, dateMillis: 1000 },
    { id: "m2", aId: "p1", bId: "p2", aGoals: 0, bGoals: 3, dateMillis: 1000 },
  ];
  const rA = calculateSeason(reversed, ["p1", "p2"], 0);
  const rB = calculateSeason(sorted, ["p1", "p2"], 0);
  assert.deepEqual(
    rA.standings.map((s) => ({ uid: s.uid, elo: s.elo })),
    rB.standings.map((s) => ({ uid: s.uid, elo: s.elo })),
    "input order must not change the result",
  );
  // m1 (id-first) is processed before m2 whichever order they arrive in.
  assert.equal(rA.matches.find((m) => m.id === "m1").aEloBefore, 1500, "m1 replays first");
  assert.notEqual(rA.matches.find((m) => m.id === "m2").aEloBefore, 1500, "m2 replays second");
});

// ---------------------------------------------------------------------------
// Reigning-Premier handicap
// ---------------------------------------------------------------------------

const PREMIER_MATCH = (aGoals, bGoals) => [
  { id: "m1", aId: "p1", bId: "p2", aGoals, bGoals, dateMillis: 1000 },
];

test("premier handicap: title holder's win earns less, loss costs more", () => {
  const win = calculateSeason(PREMIER_MATCH(3, 1), ["p1", "p2"], 0, { premierId: "p1" });
  const winPlain = calculateSeason(PREMIER_MATCH(3, 1), ["p1", "p2"], 0);
  assert.equal(winPlain.matches[0].aDelta, 10, "3-1 win without handicap");
  assert.equal(win.matches[0].aDelta, 4, "3-1 win as reigning Premier earns less");

  const loss = calculateSeason(PREMIER_MATCH(1, 3), ["p1", "p2"], 0, { premierId: "p1" });
  const lossPlain = calculateSeason(PREMIER_MATCH(1, 3), ["p1", "p2"], 0);
  assert.equal(lossPlain.matches[0].aDelta, -10, "1-3 loss without handicap");
  assert.equal(loss.matches[0].aDelta, -16, "1-3 loss as reigning Premier costs more");
});

test("premier handicap: a draw moves rating against the title holder", () => {
  const r = calculateSeason(PREMIER_MATCH(2, 2), ["p1", "p2"], 0, { premierId: "p1" });
  assert.equal(r.matches[0].aDelta, -6, "Premier loses rating on a draw");
  assert.equal(r.matches[0].bDelta, 6, "opponent gains rating for drawing the Premier");
});

test("premier handicap: expected score uses the shifted rating and eloExplain reports the net adj", () => {
  const r = calculateSeason(PREMIER_MATCH(1, 1), ["p1", "p2"], 0, { premierId: "p2" });
  const ex = r.matches[0].eloExplain;
  // PREMIER_HANDICAP_ELO on B's side only: expected computed as 1500 vs 1500+100.
  assert.equal(ex.bExpected, expectedScore(1500 + PREMIER_HANDICAP_ELO, 1500));
  assert.equal(ex.aExpected, expectedScore(1500, 1500 + PREMIER_HANDICAP_ELO));
  assert.equal(ex.aPremierAdj, -PREMIER_HANDICAP_ELO, "net adj is mirrored on the opponent");
  assert.equal(ex.bPremierAdj, PREMIER_HANDICAP_ELO, "title holder carries the positive adj");
});

test("premier handicap: matches not involving the title holder are untouched", () => {
  const r = calculateSeason(PREMIER_MATCH(2, 0), ["p1", "p2", "p3"], 0, { premierId: "p3" });
  const plain = calculateSeason(PREMIER_MATCH(2, 0), ["p1", "p2", "p3"], 0);
  assert.equal(r.matches[0].aDelta, plain.matches[0].aDelta);
  assert.equal(r.matches[0].bDelta, plain.matches[0].bDelta);
  assert.equal(r.matches[0].eloExplain.aPremierAdj, 0);
  assert.equal(r.matches[0].eloExplain.bPremierAdj, 0);
});

test("premier handicap: stacks with the team-strength handicap", () => {
  const r = calculateSeason(
    [
      {
        id: "m1",
        aId: "p1",
        bId: "p2",
        aGoals: 1,
        bGoals: 1,
        dateMillis: 1000,
        aTeamOverall: 80,
        bTeamOverall: 85,
      },
    ],
    ["p1", "p2"],
    0,
    { premierId: "p1" },
  );
  const ex = r.matches[0].eloExplain;
  // A: 1500 + 12*80 (team) + 100 (Premier); B: 1500 + 12*85 (team).
  assert.equal(ex.aExpected, expectedScore(1500 + 12 * 80 + PREMIER_HANDICAP_ELO, 1500 + 12 * 85));
  assert.equal(ex.aTeamAdj, 12 * (80 - 85), "team adj unchanged by the Premier handicap");
  assert.equal(ex.aPremierAdj, PREMIER_HANDICAP_ELO);
});

test("premier handicap: absent or null premierId reproduces the unhandicapped season", () => {
  const withNull = calculateSeason(PREMIER_MATCH(4, 2), ["p1", "p2"], 0, { premierId: null });
  const without = calculateSeason(PREMIER_MATCH(4, 2), ["p1", "p2"], 0);
  assert.deepEqual(withNull.matches, without.matches);
});
