const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBracket,
  advanceBracket,
  bracketComplete,
  bracketRunnerUpId,
} = require("../lib/finalsRules.js");

function seeds(n) {
  return Array.from({ length: n }, (_, i) => ({
    uid: `p${i + 1}`,
    rank: i + 1,
    elo: 1600 - i * 20,
  }));
}

test("top-6 bracket: eliminations open, semis seeded 1 and 2, correct feeds", () => {
  const b = buildBracket(seeds(8));
  assert.equal(b.structure, "top6");
  assert.equal(b.seeds.length, 6);
  assert.equal(b.premierId, "p1");
  assert.deepEqual([b.slots.e1.homeId, b.slots.e1.awayId], ["p3", "p6"]);
  assert.deepEqual([b.slots.e2.homeId, b.slots.e2.awayId], ["p4", "p5"]);
  assert.equal(b.slots.e1.status, "open");
  assert.equal(b.slots.e2.status, "open");
  // 1st plays the 4v5 winner, 2nd plays the 3v6 winner.
  assert.equal(b.slots.s1.homeId, "p1");
  assert.equal(b.slots.s1.awayFrom, "e2");
  assert.equal(b.slots.s2.homeId, "p2");
  assert.equal(b.slots.s2.awayFrom, "e1");
  assert.equal(b.slots.s1.status, "pending");
  assert.equal(b.slots.gf.status, "pending");
});

test("top-4 bracket: straight semis 1v4 and 2v3", () => {
  const b = buildBracket(seeds(5));
  assert.equal(b.structure, "top4");
  assert.deepEqual([b.slots.s1.homeId, b.slots.s1.awayId], ["p1", "p4"]);
  assert.deepEqual([b.slots.s2.homeId, b.slots.s2.awayId], ["p2", "p3"]);
  assert.equal(b.slots.s1.status, "open");
  assert.equal(b.slots.e1, undefined);
});

test("top-2 bracket: straight grand final", () => {
  const b = buildBracket(seeds(3));
  assert.equal(b.structure, "top2");
  assert.deepEqual([b.slots.gf.homeId, b.slots.gf.awayId], ["p1", "p2"]);
  assert.equal(b.slots.gf.status, "open");
});

test("fewer than 2 ranked players cannot start finals", () => {
  assert.throws(() => buildBracket(seeds(1)), /at least 2 ranked/);
});

test("full top-6 run: winners propagate, slots open in order, runner-up reported", () => {
  let b = buildBracket(seeds(6));

  // 6th upsets 3rd; semi 2 (needs e1) opens for 2nd v 6th.
  let r = advanceBracket(b, "e1", "p6", "m-e1", "regulation");
  b = r.bracket;
  assert.deepEqual(r.opened, ["s2"]);
  assert.equal(b.slots.s2.awayId, "p6");
  assert.equal(b.slots.s2.status, "open");
  assert.equal(b.slots.s1.status, "pending");

  r = advanceBracket(b, "e2", "p4", "m-e2", "extra_time");
  b = r.bracket;
  assert.deepEqual(r.opened, ["s1"]);
  assert.equal(b.slots.s1.awayId, "p4");

  r = advanceBracket(b, "s1", "p1", "m-s1", "regulation");
  b = r.bracket;
  assert.deepEqual(r.opened, []);
  assert.equal(b.slots.gf.homeId, "p1");
  assert.equal(b.slots.gf.status, "pending");

  r = advanceBracket(b, "s2", "p6", "m-s2", "penalties");
  b = r.bracket;
  assert.deepEqual(r.opened, ["gf"]);
  assert.deepEqual([b.slots.gf.homeId, b.slots.gf.awayId], ["p1", "p6"]);
  assert.equal(bracketComplete(b), false);

  r = advanceBracket(b, "gf", "p6", "m-gf", "penalties");
  b = r.bracket;
  assert.equal(bracketComplete(b), true);
  assert.equal(b.slots.gf.winnerId, "p6");
  assert.equal(bracketRunnerUpId(b), "p1");
});

test("advancing rejects a non-participant winner and non-open slots", () => {
  const b = buildBracket(seeds(6));
  assert.throws(() => advanceBracket(b, "e1", "p4", "m", "regulation"), /not part of/);
  assert.throws(() => advanceBracket(b, "s1", "p1", "m", "regulation"), /not open/);
  const decided = advanceBracket(b, "e1", "p3", "m", "regulation").bracket;
  assert.throws(() => advanceBracket(decided, "e1", "p6", "m2", "regulation"), /not open/);
});

test("advanceBracket does not mutate its input", () => {
  const b = buildBracket(seeds(6));
  advanceBracket(b, "e1", "p3", "m", "regulation");
  assert.equal(b.slots.e1.status, "open");
  assert.equal(b.slots.s2.awayId, null);
});

test("walkover decides a slot without a match id", () => {
  const b = buildBracket(seeds(6));
  const r = advanceBracket(b, "e2", "p5", null, "walkover");
  assert.equal(r.bracket.slots.e2.decidedBy, "walkover");
  assert.equal(r.bracket.slots.e2.matchId, null);
  assert.equal(r.bracket.slots.s1.awayId, "p5");
});

test("runner-up is null until the grand final is decided", () => {
  const b = buildBracket(seeds(2));
  assert.equal(bracketRunnerUpId(b), null);
});
