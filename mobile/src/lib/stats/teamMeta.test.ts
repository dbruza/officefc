import test from "node:test";
import assert from "node:assert/strict";
import {
  biggestResults,
  bandForOverall,
  fairnessBySource,
  isRegularMatch,
  mostPickedTeams,
  winRateByBand,
  type MetaMatch,
} from "./teamMeta";
import type { Team } from "../league";

// --- Fixtures ------------------------------------------------------------------------

let seq = 0;

interface MatchOptions {
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  source?: string | null;
  finals?: boolean;
}

function match({
  aTeamId = "arsenal",
  bTeamId = "milan",
  aTeam = "Arsenal",
  bTeam = "Milan",
  aGoals,
  bGoals,
  source = "manual",
  finals = false,
}: MatchOptions): MetaMatch {
  seq += 1;
  return {
    id: `m${seq}`,
    aId: "player-a",
    bId: "player-b",
    aTeamId,
    bTeamId,
    aTeam,
    bTeam,
    aGoals,
    bGoals,
    source,
    finals,
    date: new Date(2026, 0, seq),
  };
}

function team(id: string, name: string, overall: number | null): [string, Team] {
  return [
    id,
    {
      id,
      name,
      competition: "Test League",
      category: "men",
      overall,
      attack: overall,
      midfield: overall,
      defence: overall,
      catalogueVersion: "v1",
      source: "catalogue",
      catalogueActive: true,
      active: true,
    },
  ];
}

const CATALOGUE = new Map<string, Team>([
  team("arsenal", "Arsenal", 85),
  team("milan", "Milan", 80),
  team("norwich", "Norwich", 72),
  team("custom-x", "The Office XI", null),
]);

// --- isRegularMatch ------------------------------------------------------------------

test("isRegularMatch excludes only finals ties", () => {
  assert.equal(isRegularMatch(match({ aGoals: 1, bGoals: 0 })), true);
  assert.equal(isRegularMatch(match({ aGoals: 1, bGoals: 0, finals: true })), false);
});

// --- mostPickedTeams -----------------------------------------------------------------

test("mostPickedTeams counts each side of every match and computes win rate", () => {
  const usage = mostPickedTeams(
    [
      match({ aGoals: 3, bGoals: 1 }), // arsenal W, milan L
      match({
        aTeamId: "milan",
        aTeam: "Milan",
        bTeamId: "arsenal",
        bTeam: "Arsenal",
        aGoals: 0,
        bGoals: 2,
      }), // milan L, arsenal W
      match({ aGoals: 1, bGoals: 1 }), // both D
    ],
    CATALOGUE,
  );

  assert.equal(usage.length, 2);
  const arsenal = usage.find((row) => row.name === "Arsenal");
  const milan = usage.find((row) => row.name === "Milan");
  assert.deepEqual(
    { picks: arsenal?.picks, w: arsenal?.wins, d: arsenal?.draws, l: arsenal?.losses },
    { picks: 3, w: 2, d: 1, l: 0 },
  );
  assert.equal(arsenal?.winRate, 67); // 2/3 rounded to whole percent
  assert.deepEqual(
    { picks: milan?.picks, w: milan?.wins, d: milan?.draws, l: milan?.losses },
    { picks: 3, w: 0, d: 1, l: 2 },
  );
  assert.equal(milan?.winRate, 0);
  assert.equal(arsenal?.overall, 85); // decorated from the live catalogue
});

test("mostPickedTeams sorts by picks, then win rate, then name", () => {
  const usage = mostPickedTeams(
    [
      // Milan: 4 picks (2W). Arsenal: 3 picks (2W, better rate than Milan's 50%).
      // Norwich: 2 picks (1W). The Office XI: 1 pick.
      match({ aGoals: 2, bGoals: 0 }),
      match({
        aTeamId: "norwich",
        aTeam: "Norwich",
        bTeamId: "custom-x",
        bTeam: "The Office XI",
        aGoals: 4,
        bGoals: 1,
      }),
      match({ aGoals: 1, bGoals: 0 }), // arsenal W vs milan
      match({ aGoals: 0, bGoals: 1 }), // milan W over arsenal
      match({
        aTeamId: "milan",
        aTeam: "Milan",
        bTeamId: "norwich",
        bTeam: "Norwich",
        aGoals: 3,
        bGoals: 0,
      }), // milan W, norwich L
    ],
    CATALOGUE,
  );
  assert.deepEqual(
    usage.map((row) => row.name),
    ["Milan", "Arsenal", "Norwich", "The Office XI"],
  );
});

test("mostPickedTeams falls back to the recorded name when the catalogue misses the id", () => {
  const usage = mostPickedTeams(
    [match({ aTeamId: "gone-team", aTeam: "Relocated FC", aGoals: 1, bGoals: 0 })],
    CATALOGUE,
  );
  assert.equal(usage[0]?.teamKey, "gone-team");
  assert.equal(usage[0]?.name, "Relocated FC");
  assert.equal(usage[0]?.overall, null);
});

test("mostPickedTeams ignores finals ties entirely", () => {
  const usage = mostPickedTeams([
    match({ aGoals: 5, bGoals: 0, finals: true }),
    match({
      aTeamId: "norwich",
      aTeam: "Norwich",
      bTeamId: "norwich",
      bTeam: "Norwich",
      aGoals: 1,
      bGoals: 0,
    }),
  ]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.name, "Norwich");
});

// --- win rate by band ----------------------------------------------------------------

test("bandForOverall partitions OVRs into the four bands and rejects unknowns", () => {
  assert.deepEqual(bandForOverall(null), null);
  assert.deepEqual(bandForOverall(Number.NaN), null);
  assert.equal(bandForOverall(60)?.key, "sub74");
  assert.equal(bandForOverall(73.9)?.key, "sub74");
  assert.equal(bandForOverall(74)?.key, "b74to78"); // lower bound inclusive
  assert.equal(bandForOverall(78)?.key, "b74to78");
  assert.equal(bandForOverall(79)?.key, "b79to83"); // upper bound exclusive
  assert.equal(bandForOverall(84)?.key, "b84plus");
  assert.equal(bandForOverall(92)?.key, "b84plus");
});

test("winRateByBand credits each side's pick to its own band", () => {
  const bands = winRateByBand(
    [
      // 85 vs 80: arsenal wins → b84plus W + b74to78 L.
      match({ aGoals: 2, bGoals: 0 }),
      // 72 vs 85: norwich upsets arsenal → sub74 W + b84plus L.
      match({
        aTeamId: "norwich",
        aTeam: "Norwich",
        bTeamId: "arsenal",
        bTeam: "Arsenal",
        aGoals: 1,
        bGoals: 0,
      }),
      // 80 draw 80 → one draw in each direction of the same band.
      match({
        aTeamId: "milan",
        aTeam: "Milan",
        bTeamId: "milan",
        bTeam: "Milan",
        aGoals: 1,
        bGoals: 1,
      }),
    ],
    CATALOGUE,
  );

  const byKey = new Map(bands.map((band) => [band.key, band]));
  assert.deepEqual(byKey.get("b84plus"), {
    key: "b84plus",
    label: "84+",
    picks: 2,
    wins: 1,
    winRate: 50,
  });
  assert.deepEqual(byKey.get("sub74"), {
    key: "sub74",
    label: "<74",
    picks: 1,
    wins: 1,
    winRate: 100,
  });
  // Milan's 80 belongs to the 79–83 band, so its loss as side B of game one lands there.
  assert.deepEqual(byKey.get("b79to83"), {
    key: "b79to83",
    label: "79–83",
    picks: 3, // milan L + both sides of the all-80 draw
    wins: 0,
    winRate: 0,
  });
  // No 74–78 team was ever picked — the empty band still reports.
  assert.deepEqual(byKey.get("b74to78"), {
    key: "b74to78",
    label: "74–78",
    picks: 0,
    wins: 0,
    winRate: 0,
  });
});

test("winRateByBand skips unrated teams but still returns every band zero-filled", () => {
  const bands = winRateByBand(
    [
      match({
        aTeamId: "custom-x",
        aTeam: "The Office XI",
        bTeamId: "arsenal",
        bTeam: "Arsenal",
        aGoals: 0,
        bGoals: 2,
      }),
    ],
    CATALOGUE,
  );
  assert.equal(bands.length, 4); // stable grid even when empty
  const rated = bands.find((band) => band.picks > 0);
  assert.equal(rated?.key, "b84plus"); // only Arsenal's 85 counted
  assert.ok(bands.every((band) => band.key !== undefined && band.winRate >= 0));
});

test("winRateByBand excludes finals ties", () => {
  const bands = winRateByBand([match({ aGoals: 9, bGoals: 0, finals: true })], CATALOGUE);
  assert.ok(bands.every((band) => band.picks === 0));
});

// --- fixture-engine fairness ---------------------------------------------------------

test("fairnessBySource splits higher-OVR wins, upsets and gaps per source", () => {
  const { fixture, manual } = fairnessBySource(
    [
      // FIXTURE games: the balancer gave the weaker player the stronger team, so the
      // higher-OVR side LOSES twice and wins once; gaps 5 and 10.
      match({
        source: "fixture",
        aTeamId: "arsenal",
        bTeamId: "norwich",
        aGoals: 0,
        bGoals: 2,
      }), // upset (norwich 72 beats arsenal 85), gap 13
      match({
        source: "fixture",
        aTeamId: "arsenal",
        bTeamId: "milan",
        aGoals: 1,
        bGoals: 3,
      }), // upset (milan 80 beats arsenal 85), gap 5
      match({
        source: "fixture",
        aTeamId: "arsenal",
        bTeamId: "norwich",
        aGoals: 4,
        bGoals: 1,
      }), // favourite wins, gap 13
      match({ source: "fixture", aGoals: 1, bGoals: 1 }), // draw (gap 5), excluded from rates
      match({
        source: "fixture",
        aTeamId: "custom-x",
        aTeam: "The Office XI",
        bTeamId: "norwich",
        aGoals: 3,
        bGoals: 0,
      }), // unrated side, excluded entirely
      // MANUAL game: favourite wins. Photo-logged (ai_assisted) games count as
      // hand-picked too — same deliberate-team-picking control group.
      match({ source: "manual", aGoals: 2, bGoals: 0 }),
      match({ source: "ai_assisted", aGoals: 0, bGoals: 3 }), // underdog wins: an upset
    ],
    CATALOGUE,
  );

  assert.deepEqual(
    {
      rated: fixture.ratedGames,
      decisive: fixture.decisiveRated,
      favWins: fixture.higherOvrWins,
      favRate: fixture.higherOvrWinRate,
      upsets: fixture.upsets,
      upsetRate: fixture.upsetRate,
    },
    {
      rated: 4, // three decisive + one draw; the unrated pair never counted
      decisive: 3,
      favWins: 1,
      favRate: 33,
      upsets: 2,
      upsetRate: 67,
    },
  );
  assert.equal(fixture.draws, 1);
  assert.equal(fixture.avgOvrGap, (13 + 5 + 13 + 5) / 4); // 9 — the draw's gap dilutes it honestly

  assert.equal(manual.ratedGames, 2); // manual + ai_assisted both in the hand-picked bucket
  assert.equal(manual.higherOvrWinRate, 50);
  assert.equal(manual.upsetRate, 50);
});

test("fairnessBySource treats equal-OVR decisive games as having no favourite", () => {
  const { fixture } = fairnessBySource(
    [
      match({
        source: "fixture",
        aTeamId: "milan",
        aTeam: "Milan",
        bTeamId: "milan",
        bTeam: "Milan",
        aGoals: 2,
        bGoals: 1,
      }),
    ],
    CATALOGUE,
  );
  // Decisive but zero-gap: no higher-OVR side exists, so it stays out of both rates.
  assert.equal(fixture.ratedGames, 1);
  assert.equal(fixture.decisiveRated, 0);
  assert.equal(fixture.higherOvrWinRate, 0);
  assert.equal(fixture.upsetRate, 0);
  assert.equal(fixture.avgOvrGap, 0);
});

test("fairnessBySource returns zeros with no data rather than NaNs", () => {
  const { fixture, manual } = fairnessBySource([], CATALOGUE);
  for (const stats of [fixture, manual]) {
    assert.deepEqual(
      { ...stats },
      {
        ratedGames: 0,
        decisiveRated: 0,
        higherOvrWins: 0,
        higherOvrWinRate: 0,
        upsets: 0,
        upsetRate: 0,
        draws: 0,
        avgOvrGap: 0,
      },
    );
  }
});

test("fairnessBySource ignores finals ties even when they carry a source", () => {
  const { manual } = fairnessBySource([
    match({ source: "manual", aGoals: 3, bGoals: 0, finals: true }),
  ]);
  assert.equal(manual.ratedGames, 0);
});

// --- biggest results -----------------------------------------------------------------

test("biggestResults ranks margins biggest first and breaks ties on total goals", () => {
  const results = biggestResults([
    match({ aGoals: 2, bGoals: 1 }), // margin 1
    match({ aGoals: 5, bGoals: 0, source: "ai_assisted" }), // margin 5, 5 goals
    match({ aGoals: 4, bGoals: 0 }), // margin 4
    match({ aGoals: 3, bGoals: 3 }), // draw, no margin
    match({
      aTeamId: "norwich",
      aTeam: "Norwich",
      bTeamId: "milan",
      bTeam: "Milan",
      aGoals: 0,
      bGoals: 5,
    }), // margin 5, 5 goals — tie broken by id order
  ]);

  assert.equal(results.length, 4);
  assert.deepEqual(
    results.map((result) => result.margin),
    [5, 5, 4, 1],
  );
  // The two margin-5 games keep a deterministic order (insertion ids m2 < m5).
  assert.equal(results[0]?.matchId < results[1]?.matchId, true);
  assert.equal(results[0]?.aTeamName, "Arsenal");
  assert.equal(results[1]?.aTeamName, "Norwich");
});

test("biggestResults honours the limit and drops draws entirely", () => {
  const results = biggestResults(
    [
      match({ aGoals: 1, bGoals: 0 }),
      match({ aGoals: 2, bGoals: 0 }),
      match({ aGoals: 3, bGoals: 0 }),
      match({ aGoals: 9, bGoals: 9 }),
    ],
    2,
  );
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.margin),
    [3, 2],
  );
});

test("biggestResults excludes finals blowouts", () => {
  const results = biggestResults([match({ aGoals: 7, bGoals: 0, finals: true })]);
  assert.deepEqual(results, []);
});
