/* Offline unit tests for the extraction trust layer. Run: node --test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExtraction } from "../supabase/functions/extract-match-stats/core/validate.mjs";

const cleanRaw = (over = {}) => ({
  detected_screen: true,
  confidence: 0.85,
  home: { team_name: "Riverside FC", goals: 3, possession: 58, shots: 14, shots_on_target: 7 },
  away: { team_name: "Harbour Athletic", goals: 1, possession: 42, shots: 8, shots_on_target: 4 },
  ...over,
});

test("clean read → no review needed, correct result", () => {
  const r = normalizeExtraction(cleanRaw());
  assert.equal(r.ok, true);
  assert.equal(r.requiresReview, false);
  assert.deepEqual(r.flags, []);
  assert.equal(r.suggestion.homeResult, "W");
  assert.equal(r.suggestion.home.goals, 3);
  assert.equal(r.suggestion.away.goals, 1);
});

test("non-stats screen → ok:false, app falls back to manual", () => {
  const r = normalizeExtraction(cleanRaw({ detected_screen: false }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_a_stats_screen");
  assert.equal(r.suggestion, null);
  assert.equal(r.requiresReview, true);
});

test("unreadable score → requiresReview + flag, never guessed", () => {
  const r = normalizeExtraction(cleanRaw({ home: { ...cleanRaw().home, goals: null } }));
  assert.equal(r.requiresReview, true);
  assert.ok(r.flags.includes("home_goals_unreadable"));
  assert.equal(r.suggestion.home.goals, null);
  assert.equal(r.suggestion.homeResult, null, "no result without both scores");
});

test("low confidence forces review", () => {
  const r = normalizeExtraction(cleanRaw({ confidence: 0.4 }));
  assert.equal(r.requiresReview, true);
  assert.ok(r.flags.includes("low_confidence"));
});

test("possession that doesn't sum to ~100 is flagged", () => {
  const r = normalizeExtraction(cleanRaw({
    home: { ...cleanRaw().home, possession: 60 },
    away: { ...cleanRaw().away, possession: 45 },
  }));
  assert.ok(r.flags.includes("possession_sum_off"));
  assert.equal(r.requiresReview, true);
});

test("shots-on-target above total shots is clamped + flagged", () => {
  const r = normalizeExtraction(cleanRaw({
    home: { ...cleanRaw().home, shots: 5, shots_on_target: 9 },
  }));
  assert.ok(r.flags.includes("home_sot_gt_shots"));
  assert.equal(r.suggestion.home.shots_on_target, 5);
});

test("numeric strings are coerced; possession clamps to 0–100", () => {
  const r = normalizeExtraction(cleanRaw({
    home: { team_name: "X", goals: "2", possession: "120", shots: "10", shots_on_target: "3" },
    away: { team_name: "Y", goals: "2", possession: "-5", shots: "7", shots_on_target: "2" },
  }));
  assert.equal(r.suggestion.home.goals, 2);
  assert.equal(r.suggestion.home.possession, 100);
  assert.equal(r.suggestion.away.possession, 0);
  assert.equal(r.suggestion.homeResult, "D");
});

test("garbage confidence defaults to 0 (forces review)", () => {
  const r = normalizeExtraction(cleanRaw({ confidence: "nope" }));
  assert.equal(r.confidence, 0);
  assert.equal(r.requiresReview, true);
});
