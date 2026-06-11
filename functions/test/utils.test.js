const test = require("node:test");
const assert = require("node:assert/strict");
const { seasonMatchInputsWithTeams } = require("../lib/utils.js");

// A minimal Firestore stand-in: doc() returns a ref carrying its id, getAll() returns
// snapshots whose get("overall") reads from the provided overalls map (missing id → undefined).
function fakeDb(overalls) {
  return {
    doc(path) {
      const id = path.split("/").pop();
      return { id };
    },
    async getAll(...refs) {
      return refs.map((ref) => ({
        get: (field) => (field === "overall" ? overalls[ref.id] : undefined),
      }));
    },
  };
}

function matchDoc(id, fields) {
  return {
    id,
    data: () => fields,
    get: (field) => fields[field],
  };
}

test("attaches each side's team overall to the season input", async () => {
  const docs = [
    matchDoc("m1", {
      aId: "alice",
      bId: "bob",
      aGoals: 3,
      bGoals: 1,
      aTeamId: "weak",
      bTeamId: "strong",
    }),
  ];

  const [input] = await seasonMatchInputsWithTeams(docs, fakeDb({ weak: 70, strong: 85 }));

  assert.equal(input.aTeamOverall, 70);
  assert.equal(input.bTeamOverall, 85);
});

test("maps missing team doc or non-numeric overall to null (no handicap)", async () => {
  const docs = [
    matchDoc("m1", {
      aId: "alice",
      bId: "bob",
      aGoals: 1,
      bGoals: 1,
      aTeamId: "custom", // overall absent in the map → null
      bTeamId: "missing", // team id never resolves → null
    }),
  ];

  const [input] = await seasonMatchInputsWithTeams(docs, fakeDb({ custom: null }));

  assert.equal(input.aTeamOverall, null);
  assert.equal(input.bTeamOverall, null);
});

test("a match with no team ids resolves to null overalls without reading teams", async () => {
  const docs = [matchDoc("m1", { aId: "alice", bId: "bob", aGoals: 0, bGoals: 0 })];
  let getAllCalled = false;
  const db = {
    doc: () => ({ id: "" }),
    async getAll() {
      getAllCalled = true;
      return [];
    },
  };

  const [input] = await seasonMatchInputsWithTeams(docs, db);

  assert.equal(input.aTeamOverall, null);
  assert.equal(input.bTeamOverall, null);
  assert.equal(getAllCalled, false);
});
