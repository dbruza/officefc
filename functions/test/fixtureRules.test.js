const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assignFixtureTeams,
  FIXTURE_BAND,
  FIXTURE_QUALITY_MIN,
  FIXTURE_QUALITY_MAX,
} = require("../lib/fixtureRules.js");
const { TEAM_ELO_PER_OVERALL } = require("../lib/elo.js");

// A pool with one team at every overall from 60 to 90 — wide enough that every clamped
// target gap has candidates, with out-of-window teams to prove the quality filter.
function fullPool() {
  const teams = [];
  for (let overall = 60; overall <= 90; overall++) {
    teams.push({ id: `t${overall}`, name: `Team ${overall}`, overall });
  }
  return teams;
}

test("equal ELOs deal near-equal teams within the band", () => {
  const { aTeam, bTeam, targetDiff } = assignFixtureTeams({
    pool: fullPool(),
    aElo: 1500,
    bElo: 1500,
  });
  assert.equal(targetDiff, 0);
  assert.ok(Math.abs(aTeam.overall - bTeam.overall) <= FIXTURE_BAND);
});

test("the stronger player is dealt the weaker team, offsetting the ELO gap", () => {
  const aElo = 1620;
  const bElo = 1500;
  const { aTeam, bTeam, targetDiff } = assignFixtureTeams({ pool: fullPool(), aElo, bElo });
  const expectedGap = (bElo - aElo) / TEAM_ELO_PER_OVERALL; // -10
  assert.equal(targetDiff, expectedGap);
  const dealtGap = aTeam.overall - bTeam.overall;
  assert.ok(Math.abs(dealtGap - expectedGap) <= FIXTURE_BAND, `dealt gap ${dealtGap}`);
});

test("teams outside the quality window are never dealt", () => {
  for (let i = 0; i < 25; i++) {
    const { aTeam, bTeam } = assignFixtureTeams({
      pool: fullPool(),
      aElo: 1500 + i * 20,
      bElo: 1500,
    });
    for (const team of [aTeam, bTeam]) {
      assert.ok(team.overall >= FIXTURE_QUALITY_MIN, `${team.id} below window`);
      assert.ok(team.overall <= FIXTURE_QUALITY_MAX, `${team.id} above window`);
    }
  }
});

test("an extreme ELO gap clamps to the widest achievable in-window gap", () => {
  const { aTeam, bTeam } = assignFixtureTeams({
    pool: fullPool(),
    aElo: 2100, // 600 Elo stronger → raw target -50 OVR, unachievable in a 16-point window
    bElo: 1500,
  });
  assert.ok(aTeam.overall < bTeam.overall);
  assert.ok(bTeam.overall - aTeam.overall >= FIXTURE_QUALITY_MAX - FIXTURE_QUALITY_MIN - FIXTURE_BAND);
});

test("recently used teams are avoided when alternatives exist", () => {
  const recent = new Set(["t78", "t79", "t80"]);
  for (let i = 0; i < 25; i++) {
    const { aTeam } = assignFixtureTeams({
      pool: fullPool(),
      aElo: 1500,
      bElo: 1500,
      aRecentTeamIds: recent,
    });
    assert.ok(!recent.has(aTeam.id), `dealt recently-used ${aTeam.id}`);
  }
});

test("novelty is a soft preference: a fully-recent pool still deals", () => {
  const pool = [
    { id: "x", name: "X", overall: 80 },
    { id: "y", name: "Y", overall: 81 },
  ];
  const { aTeam, bTeam } = assignFixtureTeams({
    pool,
    aElo: 1500,
    bElo: 1500,
    aRecentTeamIds: new Set(["x", "y"]),
    bRecentTeamIds: new Set(["x", "y"]),
  });
  assert.notEqual(aTeam.id, bTeam.id);
});

test("the same team is never dealt to both sides", () => {
  const pool = [
    { id: "only-a", name: "A", overall: 80 },
    { id: "only-b", name: "B", overall: 80 },
  ];
  for (let i = 0; i < 10; i++) {
    const { aTeam, bTeam } = assignFixtureTeams({ pool, aElo: 1500, bElo: 1500 });
    assert.notEqual(aTeam.id, bTeam.id);
  }
});

test("dealing is uniform-random across candidate pairs (injectable rng)", () => {
  const rolls = [0, 0.5, 0.999];
  const seen = new Set();
  for (const roll of rolls) {
    const { aTeam, bTeam } = assignFixtureTeams({
      pool: fullPool(),
      aElo: 1500,
      bElo: 1500,
      random: () => roll,
    });
    seen.add(`${aTeam.id}:${bTeam.id}`);
  }
  assert.equal(seen.size, rolls.length);
});

test("fewer than two rated teams in the window throws", () => {
  assert.throws(
    () =>
      assignFixtureTeams({
        pool: [{ id: "only", name: "Only", overall: 80 }],
        aElo: 1500,
        bElo: 1500,
      }),
    /Not enough rated teams/,
  );
});
