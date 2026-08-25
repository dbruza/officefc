/**
 * Unit tests for the pure season-recap derivation (functions/src/seasonRecap.ts).
 * Imports the compiled JS (functions/lib/seasonRecap.js) so the same file path works
 * whether tests run before or after a source change is compiled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRecap } from "../functions/lib/seasonRecap.js";
import { BASE_ELO } from "../functions/lib/elo.js";

const DAY = 86_400_000;

function match(id, aId, bId, aGoals, bGoals, dayOffset) {
  return { id, aId, bId, aGoals, bGoals, dateMillis: dayOffset * DAY };
}

function standing(uid, rank, elo, extra = {}) {
  return {
    uid,
    rank,
    elo,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    ...extra,
  };
}

test("recap: empty season (no matches) yields an empty recap", () => {
  assert.deepEqual(deriveRecap({ standings: [], matches: [], coreIds: {}, potm: [] }), {});
});

// ---------------------------------------------------------------------------
// goldenBoot
// ---------------------------------------------------------------------------

test("golden boot: most goals wins", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "top", "mid", 3, 1, 1),
      match("m2", "top", "bot", 2, 0, 2),
      match("m3", "mid", "bot", 2, 2, 3),
    ],
    coreIds: {},
    potm: [],
  });
  // top scored 5, mid 3, bot 2.
  assert.equal(recap.goldenBoot.playerId, "top");
  assert.equal(recap.goldenBoot.goals, 5);
});

test("golden boot: equal goals breaks the tie by fewer games played", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "clinical", "other", 4, 0, 1),
      match("m2", "grinder", "other", 2, 1, 2),
      match("m3", "grinder", "other", 2, 1, 3),
    ],
    coreIds: {},
    potm: [],
  });
  // Both scored 4; clinical did it in 1 game vs grinder's 2.
  assert.equal(recap.goldenBoot.playerId, "clinical");
  assert.equal(recap.goldenBoot.goals, 4);
});

test("golden boot: full tie falls back to lexical uid", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [match("m1", "zoe", "amy", 1, 1, 1)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.goldenBoot.playerId, "amy");
});

// ---------------------------------------------------------------------------
// bestDefense
// ---------------------------------------------------------------------------

test("best defense: fewest conceded among players meeting the half-games qualifier", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "keeper", "striker", 0, 0, 1),
      match("m2", "keeper", "striker", 1, 0, 2),
      match("m3", "keeper", "tourist", 2, 0, 3),
      match("m4", "keeper", "striker", 0, 0, 4),
    ],
    coreIds: {},
    potm: [],
  });
  // keeper: 4 games, 0 conceded. striker: 3 games, 1 conceded. tourist: 1 game, 0 conceded.
  // Max games 4 -> qualifier ceil(2) = 2 excludes tourist. That gate decides the award:
  // without it tourist ties keeper on conceded and wins the fewer-games tie-break on a
  // single appearance.
  assert.equal(recap.bestDefense.playerId, "keeper");
  assert.equal(recap.bestDefense.conceded, 0);
});

test("best defense: qualifier scales with the busiest player's schedule", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "a", "b", 0, 0, 1),
      match("m2", "b", "a", 2, 1, 2),
      match("m3", "a", "b", 1, 1, 3),
      match("m4", "a", "c", 0, 0, 4),
    ],
    coreIds: {},
    potm: [],
  });
  // a: 4 games / 3 conceded; b: 3 games / 2 conceded; c: 1 game / 0 conceded.
  // Qualifier ceil(4 x 1/2) = 2 excludes c even with a perfect sheet — a fixed one-game bar
  // would wrongly crown them.
  assert.equal(recap.bestDefense.playerId, "b");
  assert.equal(recap.bestDefense.conceded, 2);
});

test("best defense: tie on conceded goes to fewer games then lexical uid", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "dan", "amy", 0, 0, 1),
      match("m2", "dan", "ben", 0, 0, 2),
      match("m3", "ben", "amy", 0, 0, 3),
    ],
    coreIds: {},
    potm: [],
  });
  // All three concede 0. amy and dan played 2 games, ben played 2 as well — wait:
  // amy: m1,m3 = 2; ben: m2,m3 = 2; dan: m1,m2 = 2. Full tie -> lexical uid wins.
  assert.equal(recap.bestDefense.playerId, "amy");
  assert.equal(recap.bestDefense.conceded, 0);
});

// ---------------------------------------------------------------------------
// mostImproved
// ---------------------------------------------------------------------------

test("most improved: final Elo minus BASE_ELO start, ranked players only by construction", () => {
  const recap = deriveRecap({
    standings: [
      standing("climber", 1, BASE_ELO + 120),
      standing("flat", 2, BASE_ELO - 10),
      standing("faller", 3, BASE_ELO - 90),
    ],
    matches: [match("m1", "climber", "faller", 2, 1, 1)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.mostImproved.playerId, "climber");
  assert.equal(recap.mostImproved.eloGain, 120);
});

test("most improved: negative gain still reported when everyone fell", () => {
  const recap = deriveRecap({
    standings: [standing("leastBad", 1, BASE_ELO - 30), standing("worse", 2, BASE_ELO - 80)],
    matches: [match("m1", "leastBad", "worse", 1, 0, 1)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.mostImproved.playerId, "leastBad");
  assert.equal(recap.mostImproved.eloGain, -30);
});

test("most improved: explicit start ratings override the BASE_ELO default", () => {
  const recap = deriveRecap({
    standings: [standing("carryoverA", 1, BASE_ELO + 50), standing("freshB", 2, BASE_ELO + 60)],
    matches: [match("m1", "carryoverA", "freshB", 1, 0, 1)],
    coreIds: {},
    potm: [],
    startEloByUid: { carryoverA: BASE_ELO + 100 },
  });
  // carryoverA gained -50 from its carried-over start; freshB gained +60 from BASE_ELO.
  assert.equal(recap.mostImproved.playerId, "freshB");
  assert.equal(recap.mostImproved.eloGain, 60);
});

// ---------------------------------------------------------------------------
// longestWinStreak
// ---------------------------------------------------------------------------

test("longest win streak: consecutive wins counted in date order", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "hot", "cold", 2, 0, 3),
      match("m2", "hot", "cold", 1, 0, 1), // earlier date, must sort first
      match("m3", "hot", "cold", 3, 0, 2),
    ],
    coreIds: {},
    potm: [],
  });
  // Date order m2, m3, m1 — all wins for hot -> streak 3 despite scrambled input order.
  assert.equal(recap.longestWinStreak.playerId, "hot");
  assert.equal(recap.longestWinStreak.streak, 3);
});

test("longest win streak: a draw or loss breaks the run", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "streaky", "x", 2, 0, 1),
      match("m2", "streaky", "x", 2, 0, 2),
      match("m3", "streaky", "y", 1, 1, 3), // draw resets
      match("m4", "streaky", "x", 2, 0, 4),
      match("m5", "steady", "y", 2, 0, 5),
      match("m6", "steady", "x", 2, 0, 6),
      match("m7", "steady", "y", 2, 0, 7),
      match("m8", "steady", "x", 2, 0, 8),
    ],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.longestWinStreak.playerId, "steady");
  assert.equal(recap.longestWinStreak.streak, 4);
});

test("longest win streak: tie broken by whoever reached it first, then lexical uid", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "early", "x", 1, 0, 1),
      match("m2", "early", "y", 1, 0, 2),
      match("m3", "late", "x", 1, 0, 3),
      match("m4", "late", "y", 1, 0, 4),
    ],
    coreIds: {},
    potm: [],
  });
  // Both hit streak 2; early's peak ended at day 2, late's at day 4.
  assert.equal(recap.longestWinStreak.playerId, "early");
  assert.equal(recap.longestWinStreak.streak, 2);
});

test("longest win streak: no wins at all means the section is absent", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [match("m1", "a", "b", 1, 1, 1)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.longestWinStreak, undefined);
});

// ---------------------------------------------------------------------------
// biggestRivalry
// ---------------------------------------------------------------------------

test("biggest rivalry: pair with the most meetings regardless of home/away side", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "r1", "r2", 1, 0, 1),
      match("m2", "r2", "r1", 0, 2, 2),
      match("m3", "r1", "r2", 3, 3, 3),
      match("m4", "r1", "other", 1, 0, 4),
      match("m5", "r2", "other", 1, 0, 5),
    ],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.biggestRivalry.games, 3);
  // Pair stored lexically regardless of who was side A.
  assert.ok(recap.biggestRivalry.aId < recap.biggestRivalry.bId);
  assert.deepEqual([recap.biggestRivalry.aId, recap.biggestRivalry.bId], ["r1", "r2"]);
});

test("biggest rivalry: tie on games broken by lexical pair key", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "zed", "amy", 1, 0, 1), // amy|zed — lexically later pair
      match("m2", "ben", "cat", 1, 0, 2), // ben|cat — lexically earlier pair
      match("m3", "zed", "amy", 1, 0, 3),
      match("m4", "cat", "ben", 1, 0, 4),
    ],
    coreIds: {},
    potm: [],
  });
  // Both pairs met twice; ben|cat sorts before amy|zed... no — "ben" < "amy" is false.
  // Lexical order of the two keys: "amy|zed" < "ben|cat", so amy|zed must win the tie-break.
  assert.deepEqual([recap.biggestRivalry.aId, recap.biggestRivalry.bId], ["amy", "zed"]);
  assert.equal(recap.biggestRivalry.games, 2);
});

// ---------------------------------------------------------------------------
// gameOfTheSeason
// ---------------------------------------------------------------------------

test("game of the season: highest combined goals, earliest match wins a tie", () => {
  const recap = deriveRecap({
    standings: [],
    matches: [
      match("m1", "a", "b", 2, 1, 1), // 3 goals
      match("m2", "c", "d", 1, 1, 2), // 2 goals
      match("m3", "e", "f", 3, 0, 3), // 3 goals, later
    ],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.gameOfTheSeason.matchId, "m1");
  assert.equal(recap.gameOfTheSeason.aGoals, 2);
  assert.equal(recap.gameOfTheSeason.bGoals, 1);
});

// ---------------------------------------------------------------------------
// biggestUpset
// ---------------------------------------------------------------------------

test("biggest upset: winner finished below the loser in the table, biggest margin wins", () => {
  const recap = deriveRecap({
    standings: [
      standing("champ", 1, 1600),
      standing("mid", 2, 1500),
      standing("struggler", 3, 1400),
    ],
    matches: [
      match("m1", "champ", "struggler", 0, 1, 1), // struggler (rank 3) beats champ (rank 1): margin 1
      match("m2", "struggler", "mid", 3, 0, 2), // struggler (rank 3) beats mid (rank 2): margin 3
      match("m3", "champ", "mid", 2, 0, 3), // higher-ranked winner: not an upset
    ],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.biggestUpset.matchId, "m2");
  assert.equal(recap.biggestUpset.winnerId, "struggler");
  assert.equal(recap.biggestUpset.loserId, "mid");
  assert.equal(recap.biggestUpset.winnerGoals, 3);
  assert.equal(recap.biggestUpset.loserGoals, 0);
});

test("biggest upset: absent-from-table loser makes a debutant win an upset", () => {
  const recap = deriveRecap({
    standings: [standing("ranked", 1, 1600)],
    matches: [match("m1", "debutant", "ranked", 2, 1, 1)],
    coreIds: {},
    potm: [],
  });
  // debutant is unlisted (bottom-most) beating the table leader.
  assert.equal(recap.biggestUpset.winnerId, "debutant");
  assert.equal(recap.biggestUpset.loserId, "ranked");
});

test("biggest upset: absent when the table order never flipped", () => {
  const recap = deriveRecap({
    standings: [standing("top", 1, 1600), standing("bottom", 2, 1400)],
    matches: [match("m1", "top", "bottom", 3, 0, 1), match("m2", "top", "bottom", 2, 2, 2)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.biggestUpset, undefined);
});

test("biggest upset: margin tie broken by earliest match", () => {
  const recap = deriveRecap({
    standings: [
      standing("first", 1, 1600),
      standing("second", 2, 1500),
      standing("third", 3, 1400),
    ],
    matches: [
      match("later", "third", "first", 2, 0, 5),
      match("earlier", "second", "first", 2, 0, 2),
    ],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.biggestUpset.matchId, "earlier");
});

test("biggest upset: draws can never be upsets even across table positions", () => {
  const recap = deriveRecap({
    standings: [standing("high", 1, 1600), standing("low", 2, 1400)],
    matches: [match("m1", "low", "high", 2, 2, 1)],
    coreIds: {},
    potm: [],
  });
  assert.equal(recap.biggestUpset, undefined);
});

// ---------------------------------------------------------------------------
// Determinism & optionality
// ---------------------------------------------------------------------------

test("determinism: shuffled input order produces identical output", () => {
  const base = {
    standings: [standing("p1", 1, 1620), standing("p2", 2, 1560), standing("p3", 3, 1480)],
    matches: [
      match("m1", "p1", "p2", 2, 1, 2),
      match("m2", "p3", "p1", 0, 4, 1),
      match("m3", "p3", "p2", 2, 0, 3), // rank-3 side beats rank-2: an upset
      match("m4", "p2", "p1", 0, 3, 4),
    ],
    coreIds: { championId: "p1", runnerUpId: "p2", premierId: null },
    potm: [{ month: "2026-01", playerId: "p1", gain: 40, games: 3 }],
  };
  const forward = deriveRecap(base);
  const shuffled = deriveRecap({
    ...base,
    matches: [base.matches[3], base.matches[0], base.matches[2], base.matches[1]],
    standings: [base.standings[2], base.standings[0], base.standings[1]],
  });
  assert.deepEqual(shuffled, forward);
  // Sanity: every section fired for this rich season.
  assert.ok(forward.goldenBoot && forward.bestDefense && forward.mostImproved);
  assert.ok(forward.longestWinStreak && forward.biggestRivalry && forward.gameOfTheSeason);
  assert.ok(forward.biggestUpset);
});

test("optionality: a single drawn game yields only the derivable sections", () => {
  const recap = deriveRecap({
    standings: [standing("a", 1, 1510)],
    matches: [match("m1", "a", "b", 1, 1, 1)],
    coreIds: { championId: "a" },
    potm: [],
  });
  assert.ok(recap.goldenBoot); // gf tallies exist
  assert.ok(recap.bestDefense);
  assert.ok(recap.gameOfTheSeason);
  assert.ok(recap.biggestRivalry);
  assert.equal(recap.longestWinStreak, undefined); // no wins
  assert.equal(recap.biggestUpset, undefined); // no decided matches
  assert.ok(recap.mostImproved); // standings present
});
