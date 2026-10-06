/**
 * Unit tests for the knockout-cup bracket logic. Imports the compiled JS
 * (functions/lib/cupRules.js), matching the other root suites.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drawBracket,
  advance,
  forceAdvanceAt,
  isComplete,
  cupChampion,
  toStoredRounds,
  fromStoredRounds,
  hasDecidedTieBetween,
} from "../functions/lib/cupRules.js";

function ids(n) {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

/** Every player appears exactly once across a bracket's opening round + byes. */
function entrantsOf(bracket) {
  const seen = new Set();
  for (const tie of bracket[0]) {
    if (tie.aId) seen.add(tie.aId);
    if (tie.bId) seen.add(tie.bId);
  }
  // Byes: participants in later rounds not fed by any tie of the previous round.
  for (let r = 1; r < bracket.length; r++) {
    for (const tie of bracket[r]) {
      for (const side of [tie.aId, tie.bId]) {
        if (!side) continue;
        const fed = bracket[r - 1].some(
          (t) => t.aId === side || t.bId === side || t.winnerId === side,
        );
        if (!fed) seen.add(side);
      }
    }
  }
  return seen;
}

test("draw: power of two — everyone plays round one", () => {
  const b = drawBracket(ids(8), 42);
  assert.equal(b.length, 3); // QF, SF, F
  assert.equal(b[0].length, 4);
  assert.equal(b[1].length, 2);
  assert.equal(b[2].length, 1);
  assert.equal(entrantsOf(b).size, 8);
});

test("draw: deterministic — same seed, same bracket", () => {
  assert.deepEqual(drawBracket(ids(7), 123), drawBracket(ids(7), 123));
});

test("draw: different seeds usually produce different brackets", () => {
  const variants = new Set();
  for (let seed = 0; seed < 20; seed++) {
    variants.add(JSON.stringify(drawBracket(ids(6), seed)));
  }
  assert.ok(variants.size > 1, "20 seeds produced only one arrangement");
});

test("draw: odd count — byes land in the tail and cascade deterministically", () => {
  // 5 players: R1 = 2 ties; R2 (semi) = 1 tie between those winners; R3 (final) = semi
  // winner v the bye-holder, who is pre-seeded there and never plays an opening tie.
  const b = drawBracket(ids(5), 9);
  assert.equal(b.length, 3);
  assert.equal(b[0].length, 2);
  assert.equal(entrantsOf(b).size, 5);

  // The final starts half-unresolved, with the bye-holder already holding the other side.
  const finalists = [b[2][0].aId, b[2][0].bId];
  assert.ok(finalists.includes(null), "final starts unresolved");
  assert.ok(
    finalists.some((id) => ids(5).includes(id) && id !== null),
    "bye-holder seeded",
  );

  // Four results decide it: two opening ties, the semi, then the final vs the bye-holder.
  let cur = b;
  cur = advance(cur, cur[0][0].aId, cur[0][0].bId, cur[0][0].aId);
  cur = advance(cur, cur[0][1].aId, cur[0][1].bId, cur[0][1].bId);
  assert.ok(cur[1][0].aId && cur[1][0].bId, "semi fully populated after round 1");
  cur = advance(cur, cur[1][0].aId, cur[1][0].bId, cur[1][0].aId);
  assert.ok(!isComplete(cur), "the bye-holder still awaits the final");
  const [finalA, finalB] = [cur[2][0].aId, cur[2][0].bId];
  assert.ok(finalA && finalB, "final fully populated after the semi");
  cur = advance(cur, finalA, finalB, finalA);
  assert.equal(isComplete(cur), true);
  assert.equal(cupChampion(cur), cur[2][0].winnerId);
});

test("draw: minimum size is 2 — a straight final", () => {
  const b = drawBracket(["x", "y"], 1);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0][0].aId, b[0][0].bId], ["x", "y"]);
  assert.throws(() => drawBracket(["solo"], 1), /at least 2/);
});

test("advance: winner propagates to next round at the mapped slot", () => {
  const b = drawBracket(ids(4), 7);
  const advanced = advance(b, b[0][0].aId, b[0][0].bId, b[0][0].aId);
  assert.equal(advanced[0][0].winnerId, b[0][0].aId);
  assert.equal(advanced[1][0].aId, b[0][0].aId);
  assert.equal(isComplete(advanced), false);

  // Immutability: the input bracket is untouched.
  assert.equal(b[0][0].winnerId, null);
  assert.equal(b[1][0].aId, null);
});

test("advance: pair matches regardless of home/away order", () => {
  const b = drawBracket(ids(4), 7);
  const [tie] = b[0];
  const flipped = advance(b, tie.bId, tie.aId, tie.bId);
  assert.equal(flipped[0][0].winnerId, tie.bId);
});

test("advance: rejects an outsider as winner", () => {
  const b = drawBracket(ids(4), 7);
  const [tie] = b[0];
  assert.throws(() => advance(b, tie.aId, tie.bId, "outsider"), /not part/);
});

test("advance: second result for the same pair loses the race cleanly", () => {
  const b = drawBracket(ids(4), 7);
  const [tie] = b[0];
  const once = advance(b, tie.aId, tie.bId, tie.aId);
  assert.throws(() => advance(once, tie.aId, tie.bId, tie.bId), /No open tie/);
});

test("advance: full 6-player cup runs to a single champion", () => {
  let cur = drawBracket(ids(6), 2024);
  while (!isComplete(cur)) {
    const spot = cur
      .flatMap((round, r) => round.map((tie, t) => ({ tie, r, t })))
      .find(({ tie }) => tie.winnerId === null && tie.aId && tie.bId);
    cur = advance(cur, spot.tie.aId, spot.tie.bId, spot.tie.aId);
  }
  assert.equal(cupChampion(cur), cur[cur.length - 1][0].winnerId);
});

test("forceAdvanceAt: decides by coordinates and validates inputs", () => {
  const b = drawBracket(ids(8), 5);
  const moved = forceAdvanceAt(b, 0, 2, b[0][2].bId);
  assert.equal(moved[0][2].winnerId, b[0][2].bId);
  assert.equal(moved[1][1].aId, b[0][2].bId);

  assert.throws(() => forceAdvanceAt(b, 9, 0, "p1"), /No tie exists/);
  assert.throws(() => forceAdvanceAt(moved, 0, 2, b[0][2].aId), /already decided/);
  assert.throws(() => forceAdvanceAt(b, 0, 2, "outsider"), /not part/);
});

test("forceAdvanceAt can repair a voided-source tie (admin override path)", () => {
  // A consumed tie whose match was later voided: admin flips the winner to the other side.
  const b = drawBracket(ids(4), 11);
  const [tie] = b[0];
  const wrong = advance(b, tie.aId, tie.bId, tie.aId);
  // Direct re-decision is blocked (already decided) — that's why repair goes through a
  // rebuilt state doc, but forceAdvanceAt still guards against nonsense coordinates.
  assert.equal(wrong[0][0].winnerId, tie.aId);
  assert.throws(() => forceAdvanceAt(wrong, 0, 0, tie.bId), /already decided/);
});

/** Firestore rejects any array whose elements include an array, at any depth. */
function hasNestedArray(value) {
  if (Array.isArray(value)) {
    return value.some((item) => Array.isArray(item) || hasNestedArray(item));
  }
  if (value && typeof value === "object") return Object.values(value).some(hasNestedArray);
  return false;
}

test("storage: the raw bracket is a nested array — the shape Firestore rejected", () => {
  assert.equal(hasNestedArray(drawBracket(ids(6), 7)), true);
});

test("storage: stored rounds hold no nested arrays, at any bracket size", () => {
  for (const n of [2, 3, 5, 6, 8, 13]) {
    const stored = toStoredRounds(drawBracket(ids(n), n));
    assert.equal(hasNestedArray(stored), false, `${n} players`);
    assert.ok(stored.every((round) => Array.isArray(round.ties)));
  }
});

test("storage: round-trips a partly played bracket exactly", () => {
  let b = drawBracket(ids(6), 3);
  const [first] = b[0];
  b = advance(b, first.aId, first.bId, first.bId);
  assert.deepEqual(fromStoredRounds(toStoredRounds(b)), b);
});

test("storage: corrupt values read safely", () => {
  assert.equal(fromStoredRounds(undefined), null);
  assert.equal(fromStoredRounds("rounds"), null);
  // A round without ties reads as empty; junk sides read as null.
  assert.deepEqual(fromStoredRounds([{}, { ties: [{ aId: 3, bId: "p2" }] }]), [
    [],
    [{ aId: null, bId: "p2", winnerId: null }],
  ]);
});

test("hasDecidedTieBetween finds a decided tie for the pair, in either order", () => {
  const bracket = [
    [
      { aId: "p1", bId: "p2", winnerId: "p1" },
      { aId: "p3", bId: "p4", winnerId: null },
    ],
    [{ aId: "p1", bId: null, winnerId: null }],
  ];
  assert.equal(hasDecidedTieBetween(bracket, "p1", "p2"), true);
  assert.equal(hasDecidedTieBetween(bracket, "p2", "p1"), true);
  // An open tie, or players who never met, isn't something a void could have decided.
  assert.equal(hasDecidedTieBetween(bracket, "p3", "p4"), false);
  assert.equal(hasDecidedTieBetween(bracket, "p1", "p3"), false);
});
