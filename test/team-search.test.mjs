import { test } from "node:test";
import assert from "node:assert/strict";
import search from "../mobile/src/lib/teamSearch.js";

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
    overall: null,
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
  competition: "all",
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

test("category, competition, and OVR filters compose", () => {
  assert.deepEqual(
    search
      .filterTeams(teams, { ...defaults, category: "international", overall: "unrated" })
      .map((team) => team.id),
    ["nt-england"],
  );
  assert.deepEqual(
    search
      .filterTeams(teams, { ...defaults, competition: "Custom", overall: "unrated" })
      .map((team) => team.id),
    ["custom"],
  );
});

test("unfiltered results sort by OVR then name", () => {
  assert.deepEqual(
    search.filterTeams(teams, defaults).map((team) => team.id),
    ["bayern", "men-chelsea", "nt-england", "custom"],
  );
});
