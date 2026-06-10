import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  categoryForCompetition,
  parseTeamDump,
  stableTeamId,
} from "../scripts/import-fifa-teams.mjs";

const fixture = `Team\tLeague\tOVR\tATK\tMID\tDEF

Chelsea
England Premier League (1)\t82\t82\t81\t82

Team\tLeague\tOVR\tATK\tMID\tDEF

Chelsea
England FA Women's Super League (1)\t83\t91\t82\t83

Chelsea
England Premier League (1)\t82\t82\t81\t82

Bayern München
Germany 1. Bundesliga (1)\t85\t86\t85\t83
`;

test("import removes repeated rows and distinguishes same-name teams", () => {
  const teams = parseTeamDump(fixture);
  assert.equal(teams.length, 3);
  assert.notEqual(teams[1].id, teams[2].id);
  assert.equal(new Set(teams.map((team) => team.competition)).size, 3);
});

test("stable ids handle Unicode deterministically", () => {
  assert.equal(
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
  );
  assert.match(
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
    /^fifa23-bayern-munchen-/,
  );
});

test("women's competitions are categorized without changing ratings", () => {
  assert.equal(categoryForCompetition("France Division 1 Féminine (1)"), "women");
  assert.equal(categoryForCompetition("USA NWSL (1)"), "women");
  assert.equal(categoryForCompetition("England Premier League (1)"), "men");
});

test("malformed and out-of-range rows are rejected", () => {
  assert.throws(() => parseTeamDump("Broken Team\nMissing stats"), /Malformed/);
  assert.throws(
    () => parseTeamDump("Broken Team\nSome League\t100\t80\t80\t80"),
    /Invalid ratings/,
  );
});

test("the committed FIFA 23 dump produces the expected catalogue", () => {
  const source = readFileSync(new URL("../data/fifa23-team-list.txt", import.meta.url), "utf8");
  const teams = parseTeamDump(source);
  assert.equal(teams.length, 648);
  assert.equal(new Set(teams.map((team) => team.competition)).size, 40);
  assert.equal(Math.min(...teams.map((team) => team.overall)), 59);
  assert.equal(Math.max(...teams.map((team) => team.overall)), 85);
});
