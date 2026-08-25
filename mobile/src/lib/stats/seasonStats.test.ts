/**
 * Tests for the client-side season stats aggregation. These are pure-function
 * tests over hand-built match fixtures — no Firestore involved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOT_VOLUME_LIMIT,
  aggregateSeasonStats,
  clinicalFinishers,
  possessionLeaders,
  playersWithoutXgData,
  shotVolumeLeaders,
  type SeasonStatMatch,
} from "./seasonStats";

/** A confirmed regular-season match with no stats captured yet. */
function match(overrides: Partial<SeasonStatMatch> = {}): SeasonStatMatch {
  return {
    id: "m1",
    aId: "p1",
    bId: "p2",
    aGoals: 0,
    bGoals: 0,
    finals: false,
    aPossession: null,
    bPossession: null,
    aShots: null,
    bShots: null,
    aShotsOnTarget: null,
    bShotsOnTarget: null,
    aXg: null,
    bXg: null,
    ...overrides,
  };
}

// --- Finals exclusion ---------------------------------------------------------

test("finals matches are excluded from every board", () => {
  // One ordinary match plus one finals tie whose stats dwarf everything else.
  // If any board ever starts counting finals games these assertions fail loudly.
  const matches = [
    match({ id: "reg", aId: "regA", bId: "regB", aXg: 1, bXg: 1, aGoals: 1, bGoals: 1 }),
    match({
      id: "final",
      finals: true,
      aId: "finA",
      bId: "finB",
      aGoals: 9,
      bGoals: 8,
      aXg: 99,
      bXg: 88,
      aShots: 90,
      bShots: 80,
      aShotsOnTarget: 70,
      bShotsOnTarget: 60,
      aPossession: 95,
      bPossession: 94,
    }),
  ];

  const clinical = clinicalFinishers(matches);
  assert.ok(clinical.every((row) => row.playerId !== "finA" && row.playerId !== "finB"));
  assert.deepEqual(
    clinical.map((row) => row.playerId),
    ["regA", "regB"],
  );
  // regA scored 1 goal off 1.0 xG — the finals 9-goal haul must not have leaked in.
  const regA = clinical.find((row) => row.playerId === "regA");
  assert.equal(regA?.goals, 1);
  assert.equal(regA?.xg, 1);

  for (const board of [shotVolumeLeaders(matches), possessionLeaders(matches)]) {
    assert.ok(board.every((row) => row.playerId !== "finA" && row.playerId !== "finB"));
  }
  assert.equal(possessionLeaders(matches).length, 0); // regular match has no possession
  assert.deepEqual(playersWithoutXgData(matches), []); // both regulars carry xG
});

test("an undefined finals flag still counts as a regular match", () => {
  // Docs written before the field existed simply lack it — the canonical server
  // filter is `finals !== true`, so absence must NOT exclude.
  const matches = [match({ finals: undefined, aXg: 2, aGoals: 3 })];
  const rows = clinicalFinishers(matches);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerId, "p1");
  assert.equal(rows[0].delta, 1); // 3 goals − 2 xG
});

// --- Clinical finishers -------------------------------------------------------

test("clinical finishers sum goals and xG only across xG-carrying matches", () => {
  const matches = [
    // p1's first game has xG, second does not — the second must not dilute the delta.
    match({ id: "m1", aGoals: 3, bGoals: 0, aXg: 1.5 }),
    match({ id: "m2", aGoals: 10, bGoals: 0 }), // no xG either side
  ];
  const [row] = clinicalFinishers(matches);
  assert.equal(row.playerId, "p1");
  assert.equal(row.games, 1); // counting base is xG-carrying games
  assert.equal(row.goals, 3); // the 10-goal game stays out of the comparison…
  assert.equal(row.xg, 1.5);
  assert.equal(row.delta, 1.5);
  assert.equal(row.totalGames, 2); // …but still shows in context
});

test("a missing xG on one side never blocks the other side's row", () => {
  const matches = [match({ aXg: 2, bXg: null, aGoals: 1, bGoals: 4 })];
  const rows = clinicalFinishers(matches);
  // p1 still gets a row off their own side's xG alone…
  assert.deepEqual(
    rows.map((row) => row.playerId),
    ["p1"],
  );
  assert.equal(rows[0].delta, -1); // 1 goal − 2 xG
  // …while p2 has no xG baseline at all: no invented 0-xG row, just the coverage note.
  assert.deepEqual(playersWithoutXgData(matches), ["p2"]);
});

test("xG of exactly 0 is real data, not absence", () => {
  const matches = [match({ aXg: 0, aGoals: 0 })];
  // Only p2 — who played but never carried a value — counts as uncovered.
  assert.deepEqual(playersWithoutXgData(matches), ["p2"]);
  const [row] = clinicalFinishers(matches);
  assert.equal(row.playerId, "p1");
  assert.equal(row.delta, 0);
});

test("clinical finishers rank by delta, breaking ties by goals then id", () => {
  const matches = [
    // p1: 2 − 1 = +1 · p2: 2 − 1 = +1 (same delta, fewer goals) · p3: 0 − 0 = 0
    match({ id: "m1", aId: "p1", bId: "p3", aGoals: 2, bGoals: 0, aXg: 1, bXg: 0 }),
    match({ id: "m2", aId: "p2", bId: "p3", aGoals: 2, bGoals: 0, aXg: 1, bXg: 0 }),
  ];
  assert.deepEqual(
    clinicalFinishers(matches).map((row) => row.playerId),
    ["p1", "p2", "p3"],
  );
});

test("clinical finishers round summed xG and delta to two decimals", () => {
  const matches = [match({ aGoals: 1, aXg: 1.111 }), match({ aGoals: 1, aXg: 0.222 })];
  const [row] = clinicalFinishers(matches);
  assert.equal(row.xg, 1.33); // 1.333 → 1.33
  assert.equal(row.delta, 0.67); // 2 − 1.333 → 0.67
});

test("players who played but never carried xG are reported separately", () => {
  const matches = [
    match({ aXg: 1, aGoals: 1 }), // p1 covered, p2 bare
    match({ aId: "p2", bId: "p3" }), // p3 bare too, and has never had xG
  ];
  assert.deepEqual(playersWithoutXgData(matches), ["p2", "p3"]);
});

// --- Shot volume --------------------------------------------------------------

test("shot volume ranks by total shots with on-target percentage", () => {
  const matches = [
    match({ id: "m1", aShots: 10, aShotsOnTarget: 4 }),
    match({ id: "m2", aShots: 20, aShotsOnTarget: 5, bShots: 15, bShotsOnTarget: 9 }),
    match({ id: "m3", bShots: 8, bShotsOnTarget: 3, bId: "p4" }),
  ];
  const rows = shotVolumeLeaders([...matches]);
  assert.deepEqual(
    rows.map((row) => row.playerId),
    ["p1", "p2", "p4"], // 30 shots > 15 > 8
  );
  const p1 = rows.find((row) => row.playerId === "p1");
  assert.equal(p1?.shots, 30);
  assert.equal(p1?.shotsOnTarget, 9);
  assert.equal(p1?.accuracyPct, 30); // 9/30
  assert.equal(rows.find((row) => row.playerId === "p2")?.accuracyPct, 60); // 9/15
});

test("shot volume caps at five leaders by default", () => {
  const matches = Array.from({ length: 7 }, (_, i) =>
    match({ id: `m${i}`, aId: `s${i}`, bId: `t${i}`, aShots: 10 - i, bShots: 1 }),
  );
  const rows = shotVolumeLeaders(matches);
  assert.equal(rows.length, SHOT_VOLUME_LIMIT);
  assert.equal(SHOT_VOLUME_LIMIT, 5);
  // Highest shooters first — the cut removed the weakest, not the strongest.
  assert.deepEqual(
    rows.map((row) => row.shots),
    [10, 9, 8, 7, 6],
  );
});

test("shot volume honours an explicit limit and drops players without shots", () => {
  const matches = [
    match({ aShots: 3 }),
    match({ aId: "p3", bId: "p4" }), // played but never recorded a shot
  ];
  assert.equal(shotVolumeLeaders(matches).length, 1);
  assert.equal(shotVolumeLeaders(matches, 10).length, 1); // limit can't invent entries
});

// --- Possession ---------------------------------------------------------------

test("possession kings average only across matches that report possession", () => {
  const matches = [
    match({ aPossession: 70, bPossession: 30 }),
    match({ aPossession: 50, bPossession: 50 }),
    match({ aGoals: 1, bGoals: 2 }), // no possession this game — excluded from the mean
  ];
  const rows = possessionLeaders(matches);
  assert.deepEqual(
    rows.map((row) => row.playerId),
    ["p1", "p2"],
  );
  const p1 = rows.find((row) => row.playerId === "p1");
  assert.equal(p1?.games, 2);
  assert.equal(p1?.averagePct, 60);
});

test("equal averages break toward the larger sample", () => {
  const matches = [
    // p1: (70 + 50) / 2 = 60 across 2 games · p3: 60 in a single game.
    match({ id: "m1", aPossession: 70, bPossession: 30 }),
    match({ id: "m2", aPossession: 50 }),
    match({ id: "m3", aId: "p3", bId: "p5", aPossession: 60 }),
  ];
  const rows = possessionLeaders(matches);
  assert.deepEqual(
    rows.map((row) => row.playerId),
    ["p1", "p3", "p2"], // p1 and p3 tie at 60; p1's bigger sample ranks first, then p2 at 30
  );
});

// --- Combined entrypoint + empties ---------------------------------------------

test("aggregateSeasonStats bundles every board from one pass over the fixtures", () => {
  const matches = [match({ aXg: 2, aGoals: 3, aShots: 6, aShotsOnTarget: 4, aPossession: 55 })];
  const stats = aggregateSeasonStats(matches);
  assert.equal(stats.clinical[0]?.delta, 1);
  assert.deepEqual(stats.playersWithoutXg, ["p2"]);
  assert.equal(stats.shotVolume[0]?.shots, 6);
  assert.equal(stats.possession[0]?.averagePct, 55);
});

test("empty input yields empty boards rather than throwing", () => {
  assert.deepEqual(clinicalFinishers([]), []);
  assert.deepEqual(playersWithoutXgData([]), []);
  assert.deepEqual(shotVolumeLeaders([]), []);
  assert.deepEqual(possessionLeaders([]), []);
  const empty = aggregateSeasonStats([]);
  assert.equal(empty.clinical.length, 0);
  assert.equal(empty.shotVolume.length, 0);
  assert.equal(empty.possession.length, 0);
  assert.deepEqual(empty.playersWithoutXg, []);
});
