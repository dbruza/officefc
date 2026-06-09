const test = require("node:test");
const assert = require("node:assert/strict");
const { isLegacyPlaceholderTeam } = require("../lib/teams.js");

const catalogue = new Set(["arsenal-fc", "real-madrid-cf"]);

test("a pre-catalogue placeholder team is flagged for removal", () => {
  assert.equal(isLegacyPlaceholderTeam("crimson-albion", catalogue), true);
});

test("a catalogue team is kept", () => {
  assert.equal(isLegacyPlaceholderTeam("arsenal-fc", catalogue), false);
});

test("an admin-created team (team- prefix) is kept", () => {
  assert.equal(isLegacyPlaceholderTeam("team-1717000000000", catalogue), false);
});
