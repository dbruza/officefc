const test = require("node:test");
const assert = require("node:assert/strict");
const {
  catalogueTeamData,
  isCustomTeam,
  isSupersededCatalogueTeam,
  isWomenTeam,
  rebuildTeamCatalogueSnapshot,
  seedTeamCatalogue,
  teamSummary,
} = require("../lib/teams.js");

const catalogueTeam = {
  id: "fifa23-chelsea-abc",
  name: "Chelsea",
  competition: "England Premier League (1)",
  category: "men",
  overall: 82,
  attack: 82,
  midfield: 81,
  defence: 82,
  catalogueVersion: "fifa23",
};

test("catalogue data preserves explicit admin overrides", () => {
  assert.deepEqual(catalogueTeamData(catalogueTeam, {}), {
    name: "Chelsea",
    catalogueName: "Chelsea",
    nameOverride: null,
    competition: "England Premier League (1)",
    category: "men",
    overall: 82,
    attack: 82,
    midfield: 81,
    defence: 82,
    catalogueVersion: "fifa23",
    source: "catalogue",
    catalogueActive: true,
    active: true,
    activeOverride: null,
  });
  const overridden = catalogueTeamData(catalogueTeam, {
    nameOverride: "Chelsea House Rules",
    activeOverride: false,
  });
  assert.equal(overridden.name, "Chelsea House Rules");
  assert.equal(overridden.active, false);
});

test("custom teams survive while missing catalogue teams are superseded", () => {
  const ids = new Set([catalogueTeam.id]);
  assert.equal(isCustomTeam("team-123", {}), true);
  assert.equal(isCustomTeam("office-xi", { source: "custom" }), true);
  assert.equal(isSupersededCatalogueTeam("team-123", {}, ids), false);
  assert.equal(isSupersededCatalogueTeam("old-arsenal", {}, ids), true);
  assert.equal(isSupersededCatalogueTeam(catalogueTeam.id, {}, ids), false);
});

test("women's catalogue documents are identified for deletion", () => {
  assert.equal(isWomenTeam({ category: "women" }), true);
  assert.equal(isWomenTeam({ competition: "USA NWSL (1)" }), true);
  assert.equal(isWomenTeam({ competition: "National Teams", category: "international" }), false);
});

test("team summaries retain duplicate-name identity and nullable custom ratings", () => {
  assert.deepEqual(teamSummary("team-123", { name: "Office XI", source: "custom", active: true }), {
    id: "team-123",
    name: "Office XI",
    competition: "Custom",
    category: "custom",
    overall: null,
    attack: null,
    midfield: null,
    defence: null,
    catalogueVersion: null,
    source: "custom",
    catalogueActive: true,
    active: true,
  });
});

test("current catalogue version skips collection rewrites", async () => {
  const db = {
    doc() {
      return {
        async get() {
          return {
            exists: true,
            get(field) {
              return field === "version" ? "fifa23-men-v2" : 647;
            },
          };
        },
      };
    },
  };
  const result = await seedTeamCatalogue({ db });
  assert.deepEqual(result, {
    version: "fifa23-men-v2",
    updated: 0,
    deactivated: 0,
    deleted: 0,
    active: 647,
    skipped: true,
  });
});

test("snapshot rebuild writes active team summaries in picker order", async () => {
  let written;
  const docs = [
    {
      id: "custom",
      data: () => ({ name: "Office XI", source: "custom", active: true }),
    },
    {
      id: catalogueTeam.id,
      data: () => ({ ...catalogueTeam, source: "catalogue", active: true }),
    },
  ];
  const db = {
    collection() {
      return {
        where() {
          return { get: async () => ({ docs }) };
        },
      };
    },
    doc() {
      return {
        async set(value) {
          written = value;
        },
      };
    },
  };
  const teams = await rebuildTeamCatalogueSnapshot(db, "fifa23-men-v2");
  assert.deepEqual(
    teams.map((team) => team.id),
    [catalogueTeam.id, "custom"],
  );
  assert.equal(written.count, 2);
  assert.equal(written.version, "fifa23-men-v2");
});
