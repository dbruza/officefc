/**
 * Unit tests for the finals prediction game's pure scoring rules.
 * Imports the compiled JS (functions/lib/predictionRules.js) so the same file path works
 * whether tests run before or after a source change is compiled.
 *
 * Late-edit integrity note: since the rules freeze a slot's pick once the tie decides,
 * buildScoreboard no longer takes cutoffs — every pick present at settlement time was
 * provably written while the slot was open. These tests pin that contract: NO input shape
 * can cause a legitimately-stored pick to be dropped from scoring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPSET_POINTS,
  FAVOURITE_POINTS,
  isUpsetCall,
  predictionPoints,
  pickSurvivesCutoff,
  buildScoreboard,
} from "../functions/lib/predictionRules.js";

// A top-6 bracket's elimination ties carry fixed seeds; semis/fed slots have one seeded
// side and one fed side (seed null).
const E1 = {
  key: "e1",
  homeId: "p3",
  awayId: "p6",
  homeSeed: 3,
  awaySeed: 6,
  winnerId: "p6", // the lower seed won — an actual upset
};

const S2 = {
  key: "s2",
  homeId: "p2",
  awayId: "p6",
  homeSeed: 2,
  awaySeed: null, // fed by e1, no seed number
  winnerId: "p2",
};

// ---------------------------------------------------------------------------
// isUpsetCall
// ---------------------------------------------------------------------------

test("upset: backing the numerically higher (weaker) seed is an upset call", () => {
  assert.equal(isUpsetCall(E1, "p6"), true); // seed 6 over seed 3
  assert.equal(isUpsetCall(E1, "p3"), false); // seed 3 over seed 6 is the favourite
});

test("upset: equal seeds or any unknown seed count as upset-worthy (no favourite exists)", () => {
  const equal = { ...E1, homeSeed: 4, awaySeed: 4 };
  assert.equal(isUpsetCall(equal, "p3"), true);
  assert.equal(isUpsetCall(equal, "p6"), true);
  // Fed slot: away side has no seed — either backing counts as upset-worthy.
  assert.equal(isUpsetCall(S2, "p2"), true);
  assert.equal(isUpsetCall(S2, "p6"), true);
});

// ---------------------------------------------------------------------------
// predictionPoints
// ---------------------------------------------------------------------------

test("points: correct upset call scores 2", () => {
  assert.equal(predictionPoints(E1, { predictedWinnerId: "p6" }), UPSET_POINTS);
});

test("points: correct favourite call scores 1", () => {
  const favouriteWon = { ...E1, winnerId: "p3" };
  assert.equal(predictionPoints(favouriteWon, { predictedWinnerId: "p3" }), FAVOURITE_POINTS);
});

test("points: wrong pick scores 0 even when it backed the weaker seed", () => {
  assert.equal(predictionPoints(E1, { predictedWinnerId: "p3" }), 0);
});

test("points: walkover-decided slots score normally off winnerId alone", () => {
  const walkover = { ...E1, winnerId: "p3" }; // admin awarded it to p3
  assert.equal(predictionPoints(walkover, { predictedWinnerId: "p3" }), FAVOURITE_POINTS);
  assert.equal(predictionPoints(walkover, { predictedWinnerId: "p6" }), 0);
});

test("points: undecided slot (winnerId null) scores 0 for every pick", () => {
  const open = { ...E1, winnerId: null };
  assert.equal(predictionPoints(open, { predictedWinnerId: "p3" }), 0);
  assert.equal(predictionPoints(open, { predictedWinnerId: "p6" }), 0);
});

// ---------------------------------------------------------------------------
// pickSurvivesCutoff — fail-safe predicate for shapes the rules freeze can't vouch for
// ---------------------------------------------------------------------------

test("cutoff: a stamped-after-decision pick is dropped when both stamps are readable", () => {
  assert.equal(pickSurvivesCutoff(1000, 2000), true);
  assert.equal(pickSurvivesCutoff(3000, 2000), false);
  assert.equal(pickSurvivesCutoff(2000, 2000), true); // at the instant is not late
});

test("cutoff: unknown stamps never reject (rules freeze is the primary guarantee)", () => {
  assert.equal(pickSurvivesCutoff(9999, null), true);
  assert.equal(pickSurvivesCutoff(null, 5000), true);
  assert.equal(pickSurvivesCutoff(null, null), true);
});

// ---------------------------------------------------------------------------
// buildScoreboard
// ---------------------------------------------------------------------------

function pickDoc(predictorId, picks, updatedAtMillis = null) {
  return { predictorId, picks, updatedAtMillis };
}

test("scoreboard: points aggregate across slots with correct/wrong counts", () => {
  const e2 = {
    key: "e2",
    homeId: "p4",
    awayId: "p5",
    homeSeed: 4,
    awaySeed: 5,
    winnerId: "p5", // upset
  };
  const board = buildScoreboard(
    [E1, e2],
    [
      // Called both upsets: 2 + 2 = 4.
      pickDoc("alice", { e1: { predictedWinnerId: "p6" }, e2: { predictedWinnerId: "p5" } }),
      // Chalk both times: 0 + 0 = 0, two wrongs.
      pickDoc("bob", { e1: { predictedWinnerId: "p3" }, e2: { predictedWinnerId: "p4" } }),
      // Backed the favourite, but the underdog won: 0 points, one wrong.
      pickDoc("carol", { e1: { predictedWinnerId: "p3" } }),
    ],
  );
  assert.deepEqual(board, [
    { predictorId: "alice", points: 4, correct: 2, wrong: 0 },
    // Zero-point tie between bob (2 wrongs) and carol (1): equal on points and
    // correct count, so the predictor-id tiebreak orders them.
    { predictorId: "bob", points: 0, correct: 0, wrong: 2 },
    { predictorId: "carol", points: 0, correct: 0, wrong: 1 },
  ]);
});

test("scoreboard: sorting breaks ties on more correct picks, then predictor id", () => {
  const board = buildScoreboard(
    [E1],
    [
      pickDoc("zoe", { e1: { predictedWinnerId: "p6" } }),
      pickDoc("amy", { e1: { predictedWinnerId: "p6" } }),
      pickDoc("ned", { e1: { predictedWinnerId: "p6" } }),
    ].reverse(), // input order must not matter
  );
  assert.deepEqual(
    board.map((entry) => entry.predictorId),
    ["amy", "ned", "zoe"],
  );
});

test("scoreboard: continuing to play never erases earlier-round picks", () => {
  // The regression this suite exists for: dave picked e1 correctly, then — after it
  // decided and s2 opened — picked s2 as well. Whatever stamp his doc carries, BOTH
  // picks score; a doc-level edit time must not retroactively un-earn round-one points.
  const s2 = {
    key: "s2",
    homeId: "p2",
    awayId: "p6",
    homeSeed: 2,
    awaySeed: null,
    winnerId: "p6", // dave called the upset in both rounds
  };
  const board = buildScoreboard(
    [E1, s2],
    [pickDoc("dave", { e1: { predictedWinnerId: "p6" }, s2: { predictedWinnerId: "p6" } }, 9_999)],
  );
  assert.deepEqual(board, [{ predictorId: "dave", points: 4, correct: 2, wrong: 0 }]);
});

test("scoreboard: attribution follows the doc id, not a spoofed predictorId field", () => {
  // The rules pin the field to the doc id; the IO layer passes docSnap.id through. A
  // hand-crafted doc claiming someone else's id lands on the caller's own entry only.
  const board = buildScoreboard(
    [E1],
    [{ predictorId: "victim", picks: { e1: { predictedWinnerId: "p6" } }, updatedAtMillis: null }],
  );
  assert.deepEqual(board, [{ predictorId: "victim", points: 2, correct: 1, wrong: 0 }]);
});

test("scoreboard: malformed picks are ignored without breaking the board", () => {
  const board = buildScoreboard(
    [E1],
    [
      pickDoc("erin", { e1: {} }),
      pickDoc("finn", {}),
      pickDoc("gus", { e1: { predictedWinnerId: 42 } }),
      pickDoc("hana", { e1: { predictedWinnerId: "p6" } }),
    ],
  );
  assert.deepEqual(board, [{ predictorId: "hana", points: 2, correct: 1, wrong: 0 }]);
});

test("scoreboard: members with only undecided picks produce no entry", () => {
  const board = buildScoreboard([E1], [pickDoc("ivan", { gf: { predictedWinnerId: "p1" } })]);
  assert.deepEqual(board, []);
});
