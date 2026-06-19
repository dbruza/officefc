const test = require("node:test");
const assert = require("node:assert/strict");
const { fieldsEdited } = require("../lib/extract/extractionAudit.js");

// Extraction is image-space: home = left column (2 goals), away = right column (4 goals).
const suggestion = {
  home: { goals: 2, possession: 55, shots: 11, shots_on_target: 6 },
  away: { goals: 4, possession: 45, shots: 9, shots_on_target: 5 },
};

test("home submitter with matching values reports no edits", () => {
  const submitted = {
    myGoals: 2,
    opponentGoals: 4,
    myPossession: 55,
    opponentPossession: 45,
    myShots: 11,
    opponentShots: 9,
    myShotsOnTarget: 6,
    opponentShotsOnTarget: 5,
  };
  assert.deepEqual(fieldsEdited(suggestion, submitted, "home"), []);
});

test("away submitter: my* maps to the away image side (regression for the mySide bug)", () => {
  // The away submitter's OWN values are the extraction's away side; matching → no edits.
  const submitted = {
    myGoals: 4,
    opponentGoals: 2,
    myPossession: 45,
    opponentPossession: 55,
    myShots: 9,
    opponentShots: 11,
    myShotsOnTarget: 5,
    opponentShotsOnTarget: 6,
  };
  assert.deepEqual(fieldsEdited(suggestion, submitted, "away"), []);
});

test("away submitter editing their own goals flags the away side, not home", () => {
  const submitted = {
    myGoals: 3, // away side changed 4 -> 3
    opponentGoals: 2,
    myPossession: 45,
    opponentPossession: 55,
    myShots: 9,
    opponentShots: 11,
    myShotsOnTarget: 5,
    opponentShotsOnTarget: 6,
  };
  assert.deepEqual(fieldsEdited(suggestion, submitted, "away"), ["away_goals"]);
});

test("home submitter editing the opponent goals flags the away side", () => {
  const submitted = {
    myGoals: 2,
    opponentGoals: 5, // away side changed 4 -> 5; everything else matches the suggestion
    myPossession: 55,
    opponentPossession: 45,
    myShots: 11,
    opponentShots: 9,
    myShotsOnTarget: 6,
    opponentShotsOnTarget: 5,
  };
  assert.deepEqual(fieldsEdited(suggestion, submitted, "home"), ["away_goals"]);
});

test("null / missing raw values are ignored", () => {
  assert.deepEqual(fieldsEdited(null, { myGoals: 1 }, "home"), []);
  assert.deepEqual(fieldsEdited({ home: { goals: null }, away: {} }, { myGoals: 1 }, "home"), []);
});
