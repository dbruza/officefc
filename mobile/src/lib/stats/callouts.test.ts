/**
 * Tests for the season callouts (headlines, yearbook titles, feuds). Pure-function tests
 * over hand-built match fixtures — no Firestore involved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CALLOUT_MIN_GAMES,
  HEADLINE_LIMIT,
  emptyCallouts,
  seasonCallouts,
  type CalloutMatch,
  type Headline,
} from "./callouts";

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 1, 12);

/** A confirmed regular-season match on day `day`, no ELO or team ratings captured. */
function match(
  day: number,
  aId: string,
  bId: string,
  aGoals: number,
  bGoals: number,
  overrides: Partial<CalloutMatch> = {},
): CalloutMatch {
  return {
    id: `m${String(day).padStart(3, "0")}-${aId}-${bId}`,
    aId,
    bId,
    aTeamId: "",
    bTeamId: "",
    aTeam: "Arsenal",
    bTeam: "Chelsea",
    aGoals,
    bGoals,
    date: new Date(START + day * DAY),
    finals: false,
    aEloBefore: null,
    bEloBefore: null,
    aDelta: null,
    bDelta: null,
    ...overrides,
  };
}

const headline = (headlines: Headline[], key: Headline["key"]) =>
  headlines.find((h) => h.key === key);

/** Walks a value and fails on any `undefined` — Firestore rejects them on write. */
function assertNoUndefined(value: unknown, path = "callouts"): void {
  assert.notEqual(value, undefined, `${path} is undefined`);
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) assertNoUndefined(inner, `${path}.${key}`);
  }
}

/** Fisher–Yates with a fixed seed so the shuffle test is reproducible. */
function shuffled<T>(items: T[], seed = 7): T[] {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A small but varied season: six regulars plus one player with a single game. */
function season(): CalloutMatch[] {
  return [
    match(1, "ana", "ben", 3, 1, { aEloBefore: 1500, bEloBefore: 1500, aDelta: 18, bDelta: -18 }),
    match(2, "cat", "dan", 2, 2, { aEloBefore: 1500, bEloBefore: 1500, aDelta: 0, bDelta: 0 }),
    match(3, "eve", "fin", 5, 4, { aEloBefore: 1500, bEloBefore: 1500, aDelta: 12, bDelta: -12 }),
    match(4, "ana", "cat", 2, 0, { aEloBefore: 1518, bEloBefore: 1500, aDelta: 16, bDelta: -16 }),
    match(5, "ben", "dan", 1, 1, { aEloBefore: 1482, bEloBefore: 1500, aDelta: 1, bDelta: -1 }),
    match(6, "fin", "ana", 2, 1, { aEloBefore: 1488, bEloBefore: 1534, aDelta: 22, bDelta: -22 }),
    match(7, "eve", "cat", 4, 3, { aEloBefore: 1512, bEloBefore: 1484, aDelta: 10, bDelta: -10 }),
    match(8, "dan", "ben", 0, 0, { aEloBefore: 1499, bEloBefore: 1483, aDelta: -1, bDelta: 1 }),
    match(9, "ana", "ben", 4, 0, { aEloBefore: 1512, bEloBefore: 1484, aDelta: 20, bDelta: -20 }),
    match(10, "eve", "fin", 3, 3, { aEloBefore: 1522, bEloBefore: 1498, aDelta: -2, bDelta: 2 }),
    match(11, "cat", "dan", 1, 0, { aEloBefore: 1474, bEloBefore: 1498, aDelta: 17, bDelta: -17 }),
    match(12, "fin", "ben", 2, 1, { aEloBefore: 1500, bEloBefore: 1464, aDelta: 9, bDelta: -9 }),
    match(13, "gus", "ana", 0, 2, { aEloBefore: 1500, bEloBefore: 1532, aDelta: -8, bDelta: 8 }),
  ];
}

// --- Shape & invariants ----------------------------------------------------------------

test("no matches means no callouts", () => {
  assert.deepEqual(seasonCallouts([]), emptyCallouts());
});

test("finals ties never feed callouts", () => {
  const callouts = seasonCallouts([match(1, "ana", "ben", 9, 0, { finals: true })]);
  assert.deepEqual(callouts, emptyCallouts());
});

test("output is identical whatever order the matches arrive in", () => {
  const ordered = seasonCallouts(season());
  assert.deepEqual(seasonCallouts(shuffled(season())), ordered);
  assert.deepEqual(seasonCallouts(season().reverse()), ordered);
});

test("output is Firestore-safe (null, never undefined)", () => {
  assertNoUndefined(seasonCallouts(season()));
});

// --- Yearbook ---------------------------------------------------------------------------

test("every player who played appears exactly once in the yearbook", () => {
  const { superlatives } = seasonCallouts(season());
  const ids = superlatives.map((s) => s.playerId);
  assert.deepEqual([...ids].sort(), ["ana", "ben", "cat", "dan", "eve", "fin", "gus"]);
});

test("titles are never shared, and only regulars earn one", () => {
  const { superlatives } = seasonCallouts(season());
  const titled = superlatives.filter((s) => s.key !== "squadPlayer" && s.key !== "newSigning");
  assert.equal(new Set(titled.map((s) => s.key)).size, titled.length);
  for (const entry of titled) assert.ok(entry.games >= CALLOUT_MIN_GAMES, entry.playerId);
  const gus = superlatives.find((s) => s.playerId === "gus");
  assert.deepEqual(gus, {
    key: "newSigning",
    playerId: "gus",
    value: 1,
    extra: null,
    label: null,
    games: 1,
  });
});

test("the meanest defence is the wall", () => {
  const { superlatives } = seasonCallouts(season());
  // ana: 3 conceded in 5 games — nobody else is close.
  const ana = superlatives.find((s) => s.playerId === "ana");
  assert.equal(ana?.key, "wall");
  assert.equal(ana?.value, 0.6);
});

test("the league leader is never roasted as a flat-track bully", () => {
  // ana beats three lower-rated players and has never faced anyone rated above her —
  // that's leading the league, not bullying it.
  const matches = [
    match(1, "ana", "ben", 2, 0, { aEloBefore: 1560, bEloBefore: 1500 }),
    match(2, "ana", "cat", 2, 0, { aEloBefore: 1570, bEloBefore: 1490 }),
    match(3, "ana", "dan", 2, 0, { aEloBefore: 1580, bEloBefore: 1480 }),
    match(4, "ben", "cat", 1, 1, { aEloBefore: 1490, bEloBefore: 1480 }),
    match(5, "cat", "dan", 1, 1, { aEloBefore: 1480, bEloBefore: 1470 }),
    match(6, "dan", "ben", 1, 1, { aEloBefore: 1470, bEloBefore: 1490 }),
  ];
  const keys = seasonCallouts(matches).superlatives.map((s) => s.key);
  assert.ok(!keys.includes("flatTrackBully"));
});

test("the draw specialist is the one who keeps sharing the points", () => {
  const { superlatives } = seasonCallouts(season());
  // dan: D D D L across four games.
  const dan = superlatives.find((s) => s.playerId === "dan");
  assert.equal(dan?.key, "drawMerchant");
  assert.equal(dan?.value, 3);
});

test("the loyalist carries the team name they keep picking", () => {
  const matches = [
    match(1, "ana", "ben", 1, 0, { aTeam: "Napoli" }),
    match(2, "ana", "ben", 1, 1, { aTeam: "Napoli" }),
    match(3, "ana", "ben", 0, 1, { aTeam: "Napoli" }),
    match(4, "ana", "ben", 2, 2, { aTeam: "Napoli" }),
    match(5, "ben", "cat", 1, 0, { aTeam: "Lyon", bTeam: "Porto" }),
    match(6, "cat", "ben", 1, 0, { aTeam: "Ajax", bTeam: "Roma" }),
    match(7, "cat", "ben", 3, 1, { aTeam: "Benfica", bTeam: "Inter" }),
  ];
  const { superlatives } = seasonCallouts(matches);
  const ana = superlatives.find((s) => s.playerId === "ana");
  assert.equal(ana?.key, "loyalist");
  assert.equal(ana?.label, "Napoli");
  assert.equal(ana?.value, 100);
});

test("nobody gets a title for being below average at it", () => {
  // Two identical records: no metric separates them, so both are squad players.
  const matches = [
    match(1, "ana", "ben", 1, 0),
    match(2, "ben", "ana", 1, 0),
    match(3, "ana", "ben", 1, 1),
  ];
  const keys = seasonCallouts(matches).superlatives.map((s) => s.key);
  assert.deepEqual(keys, ["squadPlayer", "squadPlayer"]);
});

test("a season logged without ELO or team ratings still earns titles", () => {
  // Every fixture here has null ELO and unknown teams (manual logs on a fresh league).
  const matches = season().map((m) => ({
    ...m,
    aEloBefore: null,
    bEloBefore: null,
    aDelta: null,
    bDelta: null,
  }));
  const { superlatives, headlines } = seasonCallouts(matches);
  assert.ok(superlatives.some((s) => s.key !== "squadPlayer" && s.key !== "newSigning"));
  assert.ok(headlines.length > 0);
  assert.equal(headline(headlines, "upset"), undefined);
  assert.equal(headline(headlines, "swing"), undefined);
});

// --- Headlines --------------------------------------------------------------------------

test("a live win streak of three makes a heater headline; two does not", () => {
  const two = [match(1, "ana", "ben", 1, 0), match(2, "ana", "ben", 1, 0)];
  assert.equal(headline(seasonCallouts(two).headlines, "heater"), undefined);

  const three = [...two, match(3, "ana", "ben", 2, 1)];
  const heater = headline(seasonCallouts(three).headlines, "heater");
  assert.equal(heater?.playerId, "ana");
  assert.equal(heater?.value, 3);
  assert.equal(heater?.date, new Date(START + 3 * DAY).toISOString());
});

test("a streak broken by the latest game is no longer a heater", () => {
  const matches = [
    match(1, "ana", "ben", 1, 0),
    match(2, "ana", "ben", 1, 0),
    match(3, "ana", "ben", 1, 0),
    match(4, "ana", "ben", 0, 0),
  ];
  assert.equal(headline(seasonCallouts(matches).headlines, "heater"), undefined);
});

test("an upset needs a 50-point ELO gap", () => {
  const at = (gap: number) =>
    headline(
      seasonCallouts([match(1, "ana", "ben", 2, 1, { aEloBefore: 1500, bEloBefore: 1500 + gap })])
        .headlines,
      "upset",
    );
  assert.equal(at(49), undefined);
  const upset = at(50);
  assert.equal(upset?.playerId, "ana");
  assert.equal(upset?.otherId, "ben");
  assert.equal(upset?.value, 50);
  assert.deepEqual([upset?.gf, upset?.ga], [2, 1]);
});

test("a long slump never leads the headlines over good news", () => {
  // ben loses twelve in a row, to four different players (three wins each); ana adds a
  // modest three-game heater against someone else.
  const rivals = ["cat", "dan", "eve", "fin"];
  const matches = Array.from({ length: 12 }, (_, i) =>
    match(i + 1, "ben", rivals[Math.floor(i / 3)], 0, 1),
  );
  matches.push(
    match(13, "ana", "gus", 1, 0),
    match(14, "ana", "gus", 1, 0),
    match(15, "ana", "gus", 1, 0),
  );
  const { headlines } = seasonCallouts(matches);
  const slump = headline(headlines, "slump");
  assert.equal(slump?.value, 12);
  assert.equal(headlines[0].key, "heater");
  assert.equal(headlines[0].playerId, "ana");
});

test("headlines never repeat a kind, a player or a match, and stay capped", () => {
  const { headlines } = seasonCallouts(season());
  assert.ok(headlines.length > 0 && headlines.length <= HEADLINE_LIMIT);
  assert.equal(new Set(headlines.map((h) => h.key)).size, headlines.length);
  assert.equal(new Set(headlines.map((h) => h.playerId)).size, headlines.length);
  const matchIds = headlines.flatMap((h) => (h.matchId ? [h.matchId] : []));
  assert.equal(new Set(matchIds).size, matchIds.length);
  for (let i = 1; i < headlines.length; i += 1)
    assert.ok(headlines[i - 1].weight >= headlines[i].weight);
});

test("a nine-goal thriller is a goal fest from the winner's side", () => {
  const goalFest = headline(seasonCallouts(season()).headlines, "goalFest");
  assert.equal(goalFest?.playerId, "eve");
  assert.equal(goalFest?.otherId, "fin");
  assert.equal(goalFest?.value, 9);
  assert.deepEqual([goalFest?.gf, goalFest?.ga], [5, 4]);
});

test("recent headlines outrank equally big older ones", () => {
  // Two 4–0 thrashings 20 days apart: the recent one wins the single thrashing slot.
  const matches = [
    match(1, "ana", "ben", 4, 0),
    match(21, "cat", "dan", 4, 0),
    match(22, "ben", "ana", 1, 1),
  ];
  const thrashing = headline(seasonCallouts(matches).headlines, "thrashing");
  assert.equal(thrashing?.playerId, "cat");
});

// --- Feuds ------------------------------------------------------------------------------

test("pairings need three meetings to become a feud", () => {
  const two = [match(1, "ana", "ben", 1, 0), match(2, "ana", "ben", 1, 0)];
  assert.deepEqual(seasonCallouts(two).feuds, []);
});

test("feuds pick the most-played, most one-sided and closest pairings once each", () => {
  const matches = [
    // ana–ben: four meetings, ben leads 2–1 with a draw (the most-played pairing).
    match(1, "ana", "ben", 1, 2),
    match(2, "ana", "ben", 1, 1),
    match(3, "ben", "ana", 0, 3),
    match(4, "ben", "ana", 2, 0),
    // cat–dan: dan has won all three.
    match(5, "cat", "dan", 0, 1),
    match(6, "dan", "cat", 2, 0),
    match(7, "cat", "dan", 1, 3),
    // eve–fin: one win each and a draw.
    match(8, "eve", "fin", 1, 0),
    match(9, "fin", "eve", 1, 0),
    match(10, "eve", "fin", 2, 2),
  ];
  const { feuds } = seasonCallouts(matches);
  assert.deepEqual(
    feuds.map((f) => [f.key, f.playerId, f.otherId, f.w, f.d, f.l]),
    [
      ["mostPlayed", "ben", "ana", 2, 1, 1],
      ["oneSided", "dan", "cat", 3, 0, 0],
      ["deadHeat", "eve", "fin", 1, 1, 1],
    ],
  );
  const dan = feuds[1];
  assert.deepEqual([dan.gf, dan.ga, dan.lastMatchId], [6, 1, "m007-cat-dan"]);
});
