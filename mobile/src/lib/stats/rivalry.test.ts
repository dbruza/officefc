import test from "node:test";
import assert from "node:assert/strict";
import { computeRivalryStats, computeNemesisVictim } from "./rivalry";
import type { HeadToHead, H2HMeeting } from "../league/types";

let seq = 0;
function meeting(overrides: Partial<H2HMeeting> = {}): H2HMeeting {
  seq += 1;
  return {
    matchId: `m${seq}`,
    seasonId: "s1",
    date: new Date(2026, 0, seq),
    aGoals: 0,
    bGoals: 0,
    aDelta: 0,
    bDelta: 0,
    ...overrides,
  };
}

function pair(overrides: Partial<HeadToHead> = {}): HeadToHead {
  return {
    pairKey: "a__b",
    aId: "a",
    bId: "b",
    aWins: 0,
    bWins: 0,
    draws: 0,
    aGoals: 0,
    bGoals: 0,
    meetings: [],
    ...overrides,
  };
}

// --- computeRivalryStats ---

test("rivalry stats on an empty pairing are all zeroed with no averages", () => {
  const stats = computeRivalryStats(pair({ meetings: [] }));
  assert.equal(stats.games, 0);
  assert.equal(stats.biggestWin, null);
  assert.equal(stats.avgGoalsPerGame, null);
  assert.equal(stats.aCleanSheets, 0);
  assert.equal(stats.bCleanSheets, 0);
  assert.equal(stats.aEloSwing, 0);
});

test("biggest-margin win reports the winning side, score, and match", () => {
  const blowout = meeting({ matchId: "m-blowout", aGoals: 5, bGoals: 1 });
  const stats = computeRivalryStats(
    pair({
      aWins: 2,
      bWins: 0,
      aGoals: 6,
      bGoals: 1,
      meetings: [meeting({ aGoals: 1, bGoals: 0 }), blowout],
    }),
  );
  assert.ok(stats.biggestWin);
  assert.equal(stats.biggestWin.matchId, "m-blowout");
  assert.equal(stats.biggestWin.winnerId, "a");
  assert.equal(stats.biggestWin.loserId, "b");
  assert.equal(stats.biggestWin.winnerGoals, 5);
  assert.equal(stats.biggestWin.loserGoals, 1);
  assert.equal(stats.biggestWin.margin, 4);
});

test("biggest-margin win flips to side B when B dealt the heavier defeat", () => {
  const stats = computeRivalryStats(
    pair({
      aWins: 1,
      bWins: 1,
      meetings: [meeting({ aGoals: 3, bGoals: 0 }), meeting({ aGoals: 0, bGoals: 4 })],
    }),
  );
  assert.ok(stats.biggestWin);
  assert.equal(stats.biggestWin.winnerId, "b");
  assert.equal(stats.biggestWin.loserId, "a");
  assert.equal(stats.biggestWin.winnerGoals, 4);
  assert.equal(stats.biggestWin.loserGoals, 0);
});

test("a draw-only rivalry has no biggest win", () => {
  const stats = computeRivalryStats(pair({ draws: 2, meetings: [meeting(), meeting()] }));
  assert.equal(stats.biggestWin, null);
});

test("average goals per game divides combined goals across the authoritative totals", () => {
  // Meetings slice is capped at the last 20 server-side; totals come off the pair doc.
  const stats = computeRivalryStats(pair({ aGoals: 7, bGoals: 5, aWins: 3, bWins: 1, draws: 1 }));
  assert.equal(stats.games, 5);
  assert.equal(stats.totalGoals, 12);
  assert.equal(stats.avgGoalsPerGame, 2.4);
});

test("clean sheets count each way and a goalless draw counts for both", () => {
  const stats = computeRivalryStats(
    pair({
      meetings: [
        meeting({ aGoals: 2, bGoals: 0 }), // clean sheet A
        meeting({ aGoals: 0, bGoals: 3 }), // clean sheet B
        meeting({ aGoals: 0, bGoals: 0 }), // both
        meeting({ aGoals: 1, bGoals: 1 }), // neither
      ],
    }),
  );
  assert.equal(stats.aCleanSheets, 2);
  assert.equal(stats.bCleanSheets, 2);
});

test("elo swing sums per-meeting deltas for each side", () => {
  const stats = computeRivalryStats(
    pair({
      meetings: [meeting({ aDelta: 12, bDelta: -12 }), meeting({ aDelta: -8, bDelta: 8 })],
    }),
  );
  assert.equal(stats.aEloSwing, 4);
  assert.equal(stats.bEloSwing, -4);
});

// --- computeNemesisVictim ---

function h2h(aId: string, bId: string, aWins: number, bWins: number, draws = 0): HeadToHead {
  return pair({
    pairKey: [aId, bId].sort().join("__"),
    aId,
    bId,
    aWins,
    bWins,
    draws,
  });
}

test("nemesis is the worst record and victim the best once three games are played", () => {
  // vs "tough": 1-0-2 (33% share); vs "soft": 3-0-0 (100% share).
  const pairs = [h2h("me", "tough", 1, 2), h2h("me", "soft", 3, 0)];
  const { nemesis, victim } = computeNemesisVictim("me", pairs);
  assert.ok(nemesis && victim);
  assert.equal(nemesis.opponentId, "tough");
  assert.equal(victim.opponentId, "soft");
  assert.deepEqual([nemesis.wins, nemesis.draws, nemesis.losses], [1, 0, 2]);
});

test("pairings under the three-game minimum are ignored", () => {
  const { nemesis, victim } = computeNemesisVictim("me", [
    h2h("me", "small-sample", 0, 2),
    h2h("me", "qualified", 0, 3),
  ]);
  assert.ok(nemesis && victim);
  assert.equal(nemesis.opponentId, "qualified");
  assert.equal(victim.opponentId, "qualified");
});

test("draws count as half a win so a draw-heavy opponent beats an unbeaten one", () => {
  // "draws": 0W 3D → 50% share; "beats": 1W 0D 2L → 33% share.
  const { nemesis } = computeNemesisVictim("me", [
    h2h("me", "draws", 0, 0, 3),
    h2h("me", "beats", 1, 2),
  ]);
  assert.ok(nemesis);
  assert.equal(nemesis.opponentId, "beats");
});

test("records resolve whichever side of the doc the player sat on", () => {
  const { nemesis } = computeNemesisVictim("me", [
    h2h("other", "me", 3, 0), // me as side B: 0 wins, 3 losses
  ]);
  assert.ok(nemesis);
  assert.equal(nemesis.opponentId, "other");
  assert.deepEqual([nemesis.wins, nemesis.losses], [0, 3]);
});

test("no qualifying opponents yields null on both slots", () => {
  const empty = computeNemesisVictim("me", []);
  assert.equal(empty.nemesis, null);
  assert.equal(empty.victim, null);

  const underThreshold = computeNemesisVictim("me", [h2h("me", "rare", 1, 1)]);
  assert.equal(underThreshold.nemesis, null);
  assert.equal(underThreshold.victim, null);
});
