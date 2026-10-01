/* Offline unit tests for the stats-screen cross-checks (shots on target from Shot Accuracy,
   goals vs shots on target − saves) and how the trust layer applies them. Run: node --test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkScoreConsistency,
  deriveShotsOnTarget,
} from "../functions/src/extract/core/statsCheck.mjs";
import { normalizeExtraction } from "../functions/src/extract/core/validate.mjs";

// Values transcribed from a real EA SPORTS FC 27 full-time Summary tab (TV photo):
// Manchester City 3–1 Arsenal. No Shots on Target row; Shot Accuracy sits in the side panels.
const fc27Raw = (over = {}) => ({
  detected_screen: true,
  confidence: 0.9,
  home: {
    team_name: "Manchester City",
    goals: 3,
    possession: 52,
    shots: 11,
    shots_on_target: null,
    xg: 1.78,
    shot_accuracy: 82,
    saves: 8,
    ball_recovery_time: 4,
    ...over.home,
  },
  away: {
    team_name: "Arsenal",
    goals: 1,
    possession: 48,
    shots: 12,
    shots_on_target: null,
    xg: 2.4,
    shot_accuracy: 83,
    saves: 6,
    ball_recovery_time: 6,
    ...over.away,
  },
});

test("derive: shots × accuracy recovers the exact count from a whole-percent panel", () => {
  assert.deepEqual(deriveShotsOnTarget({ shots: 11, shots_on_target: null, shot_accuracy: 82 }), {
    value: 9,
    source: "derived",
  });
  assert.deepEqual(deriveShotsOnTarget({ shots: 12, shots_on_target: null, shot_accuracy: 83 }), {
    value: 10,
    source: "derived",
  });
  // Every k/n with n < 100 survives rounding to a whole percent and back.
  for (let n = 1; n < 100; n++) {
    for (let k = 0; k <= n; k++) {
      const pct = Math.round((k / n) * 100);
      assert.equal(
        deriveShotsOnTarget({ shots: n, shots_on_target: null, shot_accuracy: pct }).value,
        k,
        `${k}/${n}`,
      );
    }
  }
});

test("derive: a printed count wins; missing inputs give null", () => {
  assert.deepEqual(deriveShotsOnTarget({ shots: 10, shots_on_target: 4, shot_accuracy: 90 }), {
    value: 4,
    source: "printed",
  });
  assert.deepEqual(deriveShotsOnTarget({ shots: null, shots_on_target: null, shot_accuracy: 80 }), {
    value: null,
    source: null,
  });
  assert.deepEqual(deriveShotsOnTarget({ shots: 9, shots_on_target: null, shot_accuracy: null }), {
    value: null,
    source: null,
  });
});

test("check: the real FC 27 screen is consistent (3 = 9 − 6, 1 ≈ 10 − 8)", () => {
  const r = checkScoreConsistency(
    { goals: 3, shots_on_target: 9, saves: 8 },
    { goals: 1, shots_on_target: 10, saves: 6 },
  );
  assert.equal(r.status, "ok");
  assert.deepEqual(r.home, { goals: 3, implied: 3, ok: true });
  assert.deepEqual(r.away, { goals: 1, implied: 2, ok: true });
});

test("check: a misread score is a mismatch, with the implied goals to suggest", () => {
  const r = checkScoreConsistency(
    { goals: 8, shots_on_target: 9, saves: 8 },
    { goals: 1, shots_on_target: 10, saves: 6 },
  );
  assert.equal(r.status, "mismatch");
  assert.deepEqual(r.home, { goals: 8, implied: 3, ok: false });
  assert.equal(r.away.ok, true);
});

test("check: one side checkable is enough; nothing checkable is unknown", () => {
  assert.equal(
    checkScoreConsistency(
      { goals: 2, shots_on_target: 5, saves: null },
      { goals: 0, shots_on_target: null, saves: 3 },
    ).status,
    "ok",
  );
  assert.equal(
    checkScoreConsistency({ goals: 2, shots_on_target: null }, { goals: 1 }).status,
    "unknown",
  );
});

test("check: an own goal (one goal over the implied count) is tolerated", () => {
  assert.equal(
    checkScoreConsistency(
      { goals: 2, shots_on_target: 3, saves: 2 },
      { goals: 0, shots_on_target: 3, saves: 2 },
    ).status,
    "ok",
  );
});

test("trust layer: FC 27 summary read → derived shots on target, consistent, no review", () => {
  const r = normalizeExtraction(fc27Raw());
  assert.equal(r.ok, true);
  assert.deepEqual(r.flags, []);
  assert.equal(r.requiresReview, false);
  assert.equal(r.consistency.status, "ok");
  assert.equal(r.suggestion.home.shots_on_target, 9);
  assert.equal(r.suggestion.home.shots_on_target_source, "derived");
  assert.equal(r.suggestion.away.shots_on_target, 10);
  assert.equal(r.suggestion.home.saves, 8);
  assert.equal(r.suggestion.away.ball_recovery_time, 6);
  assert.equal(r.suggestion.home.shot_accuracy, 82);
});

test("trust layer: a score that contradicts the stats forces review", () => {
  const r = normalizeExtraction(fc27Raw({ home: { goals: 8 } }));
  assert.equal(r.consistency.status, "mismatch");
  assert.ok(r.flags.includes("score_stats_mismatch"));
  assert.equal(r.requiresReview, true);
});

test("trust layer: implausible recovery times and junk reads become null", () => {
  const r = normalizeExtraction(
    fc27Raw({ home: { ball_recovery_time: 400, saves: -2 }, away: { shot_accuracy: "83%" } }),
  );
  assert.equal(r.suggestion.home.ball_recovery_time, null);
  assert.equal(r.suggestion.home.saves, null);
  assert.equal(r.suggestion.away.shot_accuracy, 83);
});
