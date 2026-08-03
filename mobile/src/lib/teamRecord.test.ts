import test from "node:test";
import assert from "node:assert/strict";
import { computeTeamRecords, BEST_TEAM_MIN_GAMES } from "./teamRecord";
import type { LeagueMatch, Team } from "./league";

const ME = "me";

interface MatchOptions {
  team: string;
  teamName?: string;
  gf: number;
  ga: number;
  delta?: number;
  /** Play as side B (the opponent's submission) rather than side A. */
  away?: boolean;
  day?: number;
}

let seq = 0;
function match({ team, teamName, gf, ga, delta = 0, away = false, day = 1 }: MatchOptions) {
  seq += 1;
  const mine = { id: team, name: teamName ?? team, goals: gf, delta };
  const theirs = { id: "opp-team", name: "Opponent FC", goals: ga, delta: -delta };
  const [a, b] = away ? [theirs, mine] : [mine, theirs];
  return {
    id: `m${seq}`,
    seasonId: "s1",
    submittedBy: ME,
    aId: away ? "rival" : ME,
    bId: away ? ME : "rival",
    aTeamId: a.id,
    bTeamId: b.id,
    aTeam: a.name,
    bTeam: b.name,
    aGoals: a.goals,
    bGoals: b.goals,
    status: "confirmed",
    source: "manual",
    date: new Date(2026, 0, day),
    photoPath: null,
    aEloBefore: null,
    aEloAfter: null,
    aDelta: a.delta,
    bEloBefore: null,
    bEloAfter: null,
    bDelta: b.delta,
  } as LeagueMatch;
}

test("aggregates a player's record per team from both sides of the match", () => {
  const { teams } = computeTeamRecords(ME, [
    match({ team: "arsenal", gf: 3, ga: 1, delta: 8 }),
    match({ team: "arsenal", gf: 0, ga: 2, delta: -6, away: true, day: 2 }),
    match({ team: "arsenal", gf: 1, ga: 1, delta: 1, day: 3 }),
    match({ team: "milan", gf: 2, ga: 0, delta: 5, day: 4 }),
  ]);

  assert.deepEqual(
    teams.map((team) => team.teamId),
    ["arsenal", "milan"],
  );
  const arsenal = teams[0];
  assert.deepEqual(
    { games: arsenal.games, w: arsenal.w, d: arsenal.d, l: arsenal.l },
    { games: 3, w: 1, d: 1, l: 1 },
  );
  assert.deepEqual({ gf: arsenal.gf, ga: arsenal.ga }, { gf: 4, ga: 4 });
  assert.equal(arsenal.winRate, 33);
  assert.equal(arsenal.eloDelta, 3);
  assert.equal(arsenal.eloPerGame, 1);
  assert.deepEqual(arsenal.form, ["W", "L", "D"]);
  assert.deepEqual(arsenal.lastPlayed, new Date(2026, 0, 3));
});

test("ignores matches the player did not appear in", () => {
  const other = match({ team: "arsenal", gf: 1, ga: 0 });
  const { teams } = computeTeamRecords(ME, [{ ...other, aId: "x", bId: "y" }]);
  assert.deepEqual(teams, []);
});

test("favourite is the most-played team, ties broken by win rate", () => {
  const summary = computeTeamRecords(ME, [
    match({ team: "arsenal", gf: 1, ga: 0, day: 1 }),
    match({ team: "arsenal", gf: 0, ga: 1, day: 2 }),
    match({ team: "milan", gf: 1, ga: 0, day: 3 }),
    match({ team: "milan", gf: 2, ga: 0, day: 4 }),
  ]);
  assert.equal(summary.favourite?.teamId, "milan");
  assert.equal(summary.favourite?.winRate, 100);
});

/** A team with `count` wins, so it clears the games bar with a winning record. */
function winningRun(team: string, count: number, fromDay: number) {
  return Array.from({ length: count }, (_, index) =>
    match({ team, gf: 2, ga: 0, day: fromDay + index }),
  );
}

test("best performer needs a minimum body of work", () => {
  // Arsenal and Chelsea both clear the bar; Milan is unbeaten off a single game.
  const qualifiers = [
    ...winningRun("arsenal", BEST_TEAM_MIN_GAMES, 1),
    ...winningRun("chelsea", BEST_TEAM_MIN_GAMES - 1, 10),
    match({ team: "chelsea", gf: 0, ga: 2, day: 16 }),
  ];
  const light = computeTeamRecords(ME, [
    ...qualifiers,
    match({ team: "milan", gf: 5, ga: 0, day: 20 }),
  ]);
  assert.equal(light.best?.teamId, "arsenal");

  // Once Milan has the same sample and a better rate, it takes over.
  const enough = computeTeamRecords(ME, [
    ...qualifiers.slice(BEST_TEAM_MIN_GAMES),
    ...Array.from({ length: BEST_TEAM_MIN_GAMES }, (_, index) =>
      match({ team: "arsenal", gf: index === 0 ? 0 : 2, ga: index === 0 ? 1 : 0, day: index + 1 }),
    ),
    ...winningRun("milan", BEST_TEAM_MIN_GAMES, 20),
  ]);
  assert.equal(enough.best?.teamId, "milan");
});

test("no best team until a second team clears the same bar", () => {
  // One qualifying team would otherwise be crowned by default, however badly it played.
  const lone = computeTeamRecords(ME, [
    ...Array.from({ length: 4 }, (_, index) =>
      match({ team: "atletico", gf: 0, ga: 2, day: index + 1 }),
    ),
    match({ team: "juventus", gf: 3, ga: 0, day: 20 }),
    match({ team: "milan", gf: 2, ga: 0, day: 22 }),
  ]);
  assert.equal(lone.best, null);
});

test("no best team when the leading qualifier has a losing record", () => {
  const losing = computeTeamRecords(ME, [
    ...Array.from({ length: 3 }, (_, index) =>
      match({ team: "arsenal", gf: 0, ga: 1, day: index + 1 }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      match({ team: "milan", gf: 0, ga: 3, day: 10 + index }),
    ),
  ]);
  assert.equal(losing.best, null);
});

test("decorates rows from the catalogue and keeps the canonical name", () => {
  const catalogue = new Map<string, Team>([
    [
      "arsenal",
      {
        id: "arsenal",
        name: "Arsenal",
        competition: "Premier League",
        category: "men",
        overall: 84,
        attack: 85,
        midfield: 83,
        defence: 82,
        catalogueVersion: "v1",
        source: "catalogue",
        catalogueActive: true,
        active: true,
      },
    ],
  ]);
  const { teams } = computeTeamRecords(
    ME,
    [match({ team: "arsenal", teamName: "Arsenal FC (old)", gf: 1, ga: 0 })],
    catalogue,
  );
  assert.equal(teams[0].name, "Arsenal");
  assert.equal(teams[0].competition, "Premier League");
  assert.equal(teams[0].overall, 84);
});

test("teams missing from the catalogue keep their match name and no rating", () => {
  const { teams } = computeTeamRecords(
    ME,
    [match({ team: "team-custom", teamName: "The Office XI", gf: 1, ga: 0 })],
    new Map(),
  );
  assert.equal(teams[0].name, "The Office XI");
  assert.equal(teams[0].competition, null);
  assert.equal(teams[0].overall, null);
});

test("falls back to the team name when a legacy match has no team id", () => {
  const legacy = match({ team: "arsenal", teamName: "Arsenal", gf: 2, ga: 0 });
  const { teams } = computeTeamRecords(ME, [
    { ...legacy, aTeamId: "undefined" },
    { ...match({ team: "arsenal", teamName: "arsenal", gf: 1, ga: 3, day: 2 }), aTeamId: "" },
  ]);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].games, 2);
  assert.equal(teams[0].name, "arsenal");
});

test("returns an empty summary for a player with no games", () => {
  assert.deepEqual(computeTeamRecords(ME, []), { favourite: null, best: null, teams: [] });
});
