import { test } from "node:test";
import assert from "node:assert/strict";
import search from "../mobile/src/lib/teamSearch.js";
import { TEAM_CATALOGUE } from "../functions/lib/data/teamCatalogue.js";
import { teamNameKey } from "../functions/lib/teams.js";

const teams = [
  {
    id: "men-chelsea",
    name: "Chelsea",
    competition: "England Premier League (1)",
    category: "men",
    overall: 82,
  },
  {
    id: "nt-england",
    name: "England",
    competition: "National Teams",
    category: "international",
    overall: 84,
  },
  {
    id: "bayern",
    name: "Bayern München",
    competition: "Germany 1. Bundesliga (1)",
    category: "men",
    overall: 85,
  },
  {
    id: "custom",
    name: "Office XI",
    competition: "Custom",
    category: "custom",
    overall: null,
  },
];

const defaults = {
  query: "",
  category: "all",
  overall: "all",
};

test("search is accent-insensitive and prioritizes name matches", () => {
  assert.equal(search.normalizeTeamSearch("München"), "munchen");
  assert.deepEqual(
    search.filterTeams(teams, { ...defaults, query: "munchen" }).map((team) => team.id),
    ["bayern"],
  );
  assert.deepEqual(
    search.filterTeams(teams, { ...defaults, query: "chelsea" }).map((team) => team.id),
    ["men-chelsea"],
  );
});

test("category and OVR filters compose", () => {
  assert.deepEqual(
    search
      .filterTeams(teams, { ...defaults, category: "international", overall: "80+" })
      .map((team) => team.id),
    ["nt-england"],
  );
  assert.deepEqual(
    search.filterTeams(teams, { ...defaults, overall: "unrated" }).map((team) => team.id),
    ["custom"],
  );
});

test("unfiltered results sort by OVR then name", () => {
  assert.deepEqual(
    search.filterTeams(teams, defaults).map((team) => team.id),
    ["bayern", "nt-england", "men-chelsea", "custom"],
  );
});

const catalogue = [
  { id: "barca", name: "FC Barcelona", competition: "Spain LaLiga EA Sports", overall: 85 },
  { id: "bsc", name: "Barcelona de Guayaquil", competition: "Ecuadorian Serie A", overall: 68 },
  { id: "roma", name: "AS Roma", competition: "Italy Serie A Enilive", overall: 80 },
  { id: "romania", name: "Romania", competition: "National Teams", overall: 73 },
  { id: "milan", name: "AC Milan", competition: "Italy Serie A Enilive", overall: 80 },
  { id: "inter", name: "Inter Milan", competition: "Italy Serie A Enilive", overall: 82 },
  { id: "mci", name: "Manchester City", competition: "England Premier League", overall: 84 },
  { id: "mun", name: "Manchester United", competition: "England Premier League", overall: 82 },
  { id: "bvb", name: "Borussia Dortmund", competition: "Germany Bundesliga", overall: 81 },
  { id: "bmg", name: "Borussia Mönchengladbach", competition: "Germany Bundesliga", overall: 75 },
  { id: "psg", name: "Paris Saint-Germain", competition: "France Ligue 1", overall: 85 },
  { id: "pfc", name: "Paris FC", competition: "France Ligue 1", overall: 75 },
  { id: "bha", name: "Brighton & Hove Albion", competition: "England Premier League", overall: 78 },
];

const matchId = (name) => search.matchTeamName(catalogue, name)?.id ?? null;

test("team-name matching ignores club affixes, accents and punctuation", () => {
  assert.equal(search.teamNameCore("FC Barcelona"), "barcelona");
  assert.equal(search.teamNameCore("Atlético de Madrid"), "atletico madrid");
  assert.equal(search.teamNameCore("Bayer 04 Leverkusen"), "bayer leverkusen");
  assert.equal(matchId("Barcelona"), "barca");
  assert.equal(matchId("Roma"), "roma");
  assert.equal(matchId("Milan"), "milan");
  assert.equal(matchId("brighton and hove albion"), "bha");
  assert.equal(matchId("Borussia Monchengladbach"), "bmg");
});

test("team-name matching resolves short names and scoreboard codes through aliases", () => {
  assert.equal(matchId("Man City"), "mci");
  assert.equal(matchId("MUN"), "mun");
  assert.equal(matchId("Inter"), "inter");
  assert.equal(matchId("PSG"), "psg");
  assert.equal(matchId("BVB"), "bvb");
});

test("team-name matching falls back to a whole word only one team has", () => {
  assert.equal(matchId("Dortmund"), "bvb");
  assert.equal(matchId("Guayaquil"), "bsc");
  // "Barc" is a prefix, not a word: search finds it, auto-matching must not.
  assert.equal(matchId("Barc"), null);
});

test("team-name matching refuses to guess between candidates", () => {
  assert.equal(matchId("Manchester"), null);
  assert.equal(matchId("Borussia"), null);
  assert.equal(matchId("Paris"), null);
  assert.equal(matchId("FC"), null);
  assert.equal(matchId(""), null);
  assert.equal(matchId(null), null);
  assert.equal(matchId("Office XI"), null);
});

test("an exact catalogue name wins over an alias", () => {
  const withInterTeam = [...catalogue, { id: "inter-exact", name: "Inter", overall: 70 }];
  assert.equal(search.matchTeamName(withInterTeam, "Inter")?.id, "inter-exact");
});

test("every team alias targets exactly one team in the bundled catalogue", () => {
  for (const [alias, target] of Object.entries(search.TEAM_ALIASES)) {
    if (target === null) continue;
    const core = search.teamNameCore(target);
    const hits = TEAM_CATALOGUE.filter((team) => search.teamNameCore(team.name) === core);
    assert.equal(hits.length, 1, `alias "${alias}" → "${target}" matched ${hits.length} teams`);
  }
});

test("names a stats screen prints resolve to the right FC 27 team", () => {
  const expected = {
    Barcelona: "FC Barcelona",
    Roma: "AS Roma",
    Milan: "AC Milan",
    Inter: "Inter Milan",
    "Man City": "Manchester City",
    Spurs: "Tottenham Hotspur",
    PSG: "Paris Saint-Germain",
    "Real Madrid CF": "Real Madrid",
    "FC Bayern München": "Bayern München",
    "Atlético de Madrid": "Atlético Madrid",
    Liverpool: "Liverpool FC",
    Juventus: "Juventus FC",
    Wolves: "Wolverhampton Wanderers",
    England: "England",
  };
  for (const [printed, name] of Object.entries(expected)) {
    assert.equal(search.matchTeamName(TEAM_CATALOGUE, printed)?.name, name, printed);
  }
  for (const ambiguous of ["Manchester", "Madrid", "Paris", "United", "Borussia"]) {
    assert.equal(search.matchTeamName(TEAM_CATALOGUE, ambiguous), null, ambiguous);
  }
});

test("no two catalogue teams share a name once club affixes are dropped", () => {
  const seen = new Map();
  for (const team of TEAM_CATALOGUE) {
    const core = search.teamNameCore(team.name);
    assert.ok(core, `${team.name} has no distinctive words`);
    assert.ok(!seen.has(core), `${team.name} and ${seen.get(core)} both reduce to "${core}"`);
    seen.set(core, team.name);
  }
});

test("the backend's team name key reduces names exactly like the app's matcher", () => {
  const samples = [
    ...TEAM_CATALOGUE.map((team) => team.name),
    "Brighton & Hove Albion",
    "1. FSV Mainz 05",
    "Atlético de Madrid",
    "FC",
    "",
  ];
  for (const name of samples) assert.equal(teamNameKey(name), search.teamNameCore(name), name);
});
