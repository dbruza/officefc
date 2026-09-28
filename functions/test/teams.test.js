const test = require("node:test");
const assert = require("node:assert/strict");
const {
  catalogueTeamData,
  isCustomTeam,
  isSupersededCatalogueTeam,
  isWomenTeam,
  planOverrideCarryOver,
  rebuildTeamCatalogueSnapshot,
  seedTeamCatalogue,
  teamNameKey,
  teamSummary,
} = require("../lib/teams.js");
const { TEAM_CATALOGUE, TEAM_CATALOGUE_VERSION } = require("../lib/data/teamCatalogue.js");

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
  // Previous-game catalogue docs, including the legacy national-team ids, are retired rather
  // than re-rated, so matches already played keep the ratings they were played with.
  assert.equal(isSupersededCatalogueTeam("nt-england", { category: "international" }, ids), true);
  assert.equal(isSupersededCatalogueTeam("fifa23-liverpool-4b1c", {}, ids), true);
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
              return field === "version" ? TEAM_CATALOGUE_VERSION : 735;
            },
          };
        },
      };
    },
  };
  const result = await seedTeamCatalogue({ db });
  assert.deepEqual(result, {
    version: TEAM_CATALOGUE_VERSION,
    updated: 0,
    deactivated: 0,
    deleted: 0,
    active: 735,
    overridesCarried: 0,
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
  const teams = await rebuildTeamCatalogueSnapshot(db, "fifa23-men-v4");
  assert.deepEqual(
    teams.map((team) => team.id),
    [catalogueTeam.id, "custom"],
  );
  assert.equal(written.count, 2);
  assert.equal(written.version, "fifa23-men-v4");
});

test("team name keys survive a new edition's club renames", () => {
  assert.equal(teamNameKey("Chelsea"), teamNameKey("Chelsea FC"));
  assert.equal(teamNameKey("Atlético de Madrid"), teamNameKey("Atlético Madrid"));
  assert.equal(teamNameKey("Milan"), teamNameKey("AC Milan"));
  assert.notEqual(teamNameKey("Milan"), teamNameKey("Inter Milan"));
  assert.equal(teamNameKey("Bayer 04 Leverkusen"), "bayer leverkusen");
});

const fc27 = (name) => {
  const team = TEAM_CATALOGUE.find((entry) => entry.name === name);
  assert.ok(team, `${name} is in the bundled catalogue`);
  return team;
};

const retiring = (id, data) => ({
  id,
  data: { source: "catalogue", catalogueActive: true, category: "men", ...data },
});

test("renames and hides on a retiring club carry to the same club in the new catalogue", () => {
  const plan = planOverrideCarryOver(
    TEAM_CATALOGUE,
    [
      retiring("fifa23-chelsea", {
        name: "The Blues",
        catalogueName: "Chelsea",
        nameOverride: "The Blues",
        activeOverride: null,
      }),
      retiring("fifa23-juventus", {
        name: "Juventus",
        catalogueName: "Juventus",
        nameOverride: null,
        activeOverride: false,
      }),
      retiring("fifa23-arsenal", { name: "Arsenal", catalogueName: "Arsenal" }),
    ],
    TEAM_CATALOGUE_VERSION,
  );
  assert.deepEqual(plan.get(fc27("Chelsea FC").id), {
    sourceId: "fifa23-chelsea",
    nameOverride: "The Blues",
    activeOverride: null,
  });
  assert.deepEqual(plan.get(fc27("Juventus FC").id), {
    sourceId: "fifa23-juventus",
    nameOverride: null,
    activeOverride: false,
  });
  // No overrides, nothing to carry.
  assert.equal(plan.has(fc27("Arsenal FC").id), false);
  assert.equal(plan.size, 2);
});

test("override carry-over skips anything it would have to guess", () => {
  const chelsea = fc27("Chelsea FC");
  const renamed = { catalogueName: "Chelsea", nameOverride: "The Blues" };
  const plan = (existing) =>
    planOverrideCarryOver(TEAM_CATALOGUE, existing, TEAM_CATALOGUE_VERSION).size;

  // Already carried once: an admin may since have cleared it on the new team.
  assert.equal(plan([retiring("a", { ...renamed, overridesCarriedTo: chelsea.id })]), 0);
  // Retired by an older catalogue, not this one.
  assert.equal(
    plan([retiring("a", { ...renamed, catalogueActive: false, supersededByVersion: "fifa22" })]),
    0,
  );
  // Two retiring docs claim the same club.
  assert.equal(plan([retiring("a", renamed), retiring("b", renamed)]), 0);
  // The new team already carries its own override.
  assert.equal(
    plan([retiring("a", renamed), { id: chelsea.id, data: { nameOverride: "Chelsea (27)" } }]),
    0,
  );
  // A club never maps onto a national side, or the reverse.
  assert.equal(plan([retiring("a", { ...renamed, category: "international" })]), 0);
  // Custom teams aren't catalogue teams, so they're never retired.
  assert.equal(plan([{ id: "team-1", data: { source: "custom", ...renamed } }]), 0);
  // Retired by this same version in an earlier run: still carried.
  assert.equal(
    plan([
      retiring("a", {
        ...renamed,
        catalogueActive: false,
        supersededByVersion: TEAM_CATALOGUE_VERSION,
      }),
    ]),
    1,
  );
});

test("a catalogue sync writes carried overrides and stamps each retiree once", async () => {
  const chelsea = fc27("Chelsea FC");
  const docs = [
    retiring("fifa23-chelsea", {
      name: "The Blues",
      catalogueName: "Chelsea",
      nameOverride: "The Blues",
    }),
    retiring("fifa22-old", {
      name: "Old Club",
      catalogueActive: false,
      supersededByVersion: "fifa23-men-v4",
    }),
  ].map(({ id, data }) => ({ id, ref: { path: `teams/${id}` }, data: () => data }));
  const writes = new Map();
  const db = {
    doc(path) {
      return {
        path,
        async get() {
          return { exists: false, get: () => undefined };
        },
        async set() {},
      };
    },
    collection() {
      return {
        get: async () => ({ docs }),
        where: () => ({ get: async () => ({ docs: [] }) }),
      };
    },
    bulkWriter() {
      return {
        set(ref, value) {
          writes.set(ref.path, { ...(writes.get(ref.path) ?? {}), ...value });
        },
        delete() {},
        async close() {},
      };
    },
  };

  const result = await seedTeamCatalogue({ db, force: true });
  assert.equal(result.overridesCarried, 1);

  const target = writes.get(`teams/${chelsea.id}`);
  assert.equal(target.name, "The Blues");
  assert.equal(target.nameOverride, "The Blues");
  assert.equal(target.catalogueName, "Chelsea FC");

  const source = writes.get("teams/fifa23-chelsea");
  assert.equal(source.active, false);
  assert.equal(source.overridesCarriedTo, chelsea.id);
  assert.equal(source.supersededByVersion, TEAM_CATALOGUE_VERSION);

  // A team an older catalogue retired keeps the version that retired it.
  const old = writes.get("teams/fifa22-old");
  assert.equal(old.active, false);
  assert.equal("supersededByVersion" in old, false);
});
