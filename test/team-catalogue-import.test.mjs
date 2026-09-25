import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCatalogue,
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

Argentina
National Teams\t82\t86\t83\t80
`;

test("import removes repeated rows and distinguishes same-name teams", () => {
  const teams = parseTeamDump(fixture);
  assert.equal(teams.length, 4);
  const chelseas = teams.filter((team) => team.name === "Chelsea");
  assert.equal(chelseas.length, 2);
  assert.notEqual(chelseas[0].id, chelseas[1].id);
  assert.equal(new Set(teams.map((team) => team.competition)).size, 4);
});

test("stable ids handle Unicode deterministically", () => {
  assert.equal(
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
  );
  assert.match(
    stableTeamId("Bayern München", "Germany 1. Bundesliga (1)"),
    /^fc27-bayern-munchen-/,
  );
});

test("competitions are categorized as men, women or international", () => {
  assert.equal(categoryForCompetition("France Division 1 Féminine (1)"), "women");
  assert.equal(categoryForCompetition("USA NWSL (1)"), "women");
  assert.equal(categoryForCompetition("England Premier League (1)"), "men");
  assert.equal(categoryForCompetition("National Teams"), "international");
});

test("malformed and out-of-range rows are rejected", () => {
  assert.throws(() => parseTeamDump("Broken Team\nMissing stats"), /Malformed/);
  assert.throws(
    () => parseTeamDump("Broken Team\nSome League\t100\t80\t80\t80"),
    /Invalid ratings/,
  );
});

test("the committed FC 27 dump produces the expected catalogue", () => {
  const source = readFileSync(new URL("../data/fc27-team-list.txt", import.meta.url), "utf8");
  const rawTeams = parseTeamDump(source);
  const teams = buildCatalogue(source);
  assert.equal(rawTeams.length, 735);
  assert.equal(rawTeams.filter((team) => team.category === "women").length, 0);
  assert.equal(teams.length, 735);
  assert.equal(teams.filter((team) => team.category === "international").length, 51);
  assert.equal(teams.filter((team) => team.category === "men").length, 684);
  assert.equal(new Set(teams.map((team) => team.competition)).size, 55);
  assert.ok(teams.every((team) => team.catalogueVersion === "fc27-men-v1"));
  assert.ok(teams.every((team) => team.id.startsWith("fc27-")));
  assert.equal(
    teams.find((team) => team.name === "Bayern München")?.id,
    stableTeamId("Bayern München", "Germany Bundesliga"),
  );
  const ratings = teams.flatMap((team) => (team.overall == null ? [] : [team.overall]));
  assert.equal(Math.min(...ratings), 54);
  assert.equal(Math.max(...ratings), 86);
});

test("national teams come from the dump with game-versioned ids", () => {
  const teams = buildCatalogue(fixture);
  const argentina = teams.find((team) => team.name === "Argentina");
  assert.deepEqual(argentina, {
    id: stableTeamId("Argentina", "National Teams"),
    name: "Argentina",
    competition: "National Teams",
    category: "international",
    overall: 82,
    attack: 86,
    midfield: 83,
    defence: 80,
    catalogueVersion: "fc27-men-v1",
  });
  assert.notEqual(argentina.id, "nt-argentina");
  assert.equal(
    teams.some((team) => team.category === "women"),
    false,
  );
});
