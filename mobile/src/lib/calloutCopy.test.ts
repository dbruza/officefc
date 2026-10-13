/**
 * Tests for the callout wording: the client-side title race, how it merges with the
 * server headlines, and that every title the model can hand out has copy.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  HEADLINES_SHOWN,
  SUPERLATIVE_COPY,
  feudText,
  headlineViews,
  superlativeText,
  titleRace,
} from "./calloutCopy";
import type { Standing } from "./league/types";
import type { Headline, SuperlativeKey } from "./stats/callouts";

const name = (uid: string) => uid.toUpperCase();

function standing(uid: string, rank: number, elo: number, ranked = true): Standing {
  return { uid, rank, elo, w: 0, d: 0, l: 0, gf: 0, ga: 0, form: [], move: 0, ranked };
}

function headline(key: Headline["key"], playerId: string, weight: number): Headline {
  return {
    key,
    playerId,
    otherId: null,
    matchId: null,
    value: 3,
    gf: null,
    ga: null,
    date: null,
    weight,
  };
}

test("the title race only runs on a live season with two ranked players", () => {
  const table = [standing("ana", 1, 1560), standing("ben", 2, 1540)];
  assert.equal(titleRace(table, name, false), null);
  assert.equal(titleRace([table[0]], name, true), null);
  // A provisional player can't be in the race, however high their rating.
  assert.equal(titleRace([table[0], standing("cat", 2, 1590, false)], name, true), null);
  assert.equal(titleRace(table, name, true)?.view.text.stat, "20");
});

test("a tight race is neck and neck; a level one says so", () => {
  const tight = titleRace([standing("ana", 1, 1508), standing("ben", 2, 1500)], name, true);
  assert.equal(tight?.view.text.title, "Neck and neck");
  assert.match(tight?.view.text.line ?? "", /ANA leads BEN by 8 points/);

  const level = titleRace([standing("ben", 2, 1500), standing("ana", 1, 1500)], name, true);
  assert.equal(level?.view.playerId, "ana");
  assert.match(level?.view.text.line ?? "", /ANA and BEN are level at the top/);
});

test("headline cards are biggest first, one per player, capped", () => {
  const table = [standing("ana", 1, 1505), standing("ben", 2, 1500)];
  const views = headlineViews(
    [
      headline("heater", "ana", 90),
      headline("thrashing", "cat", 70),
      headline("goalFest", "cat", 65),
      headline("upset", "dan", 40),
      headline("swing", "eve", 30),
      headline("slump", "fin", 20),
    ],
    table,
    name,
    true,
  );
  // The title race (weight 80, about ana) loses ana's slot to her heater (90).
  assert.deepEqual(
    views.map((v) => v.id),
    ["heater:ana", "thrashing:cat", "upset:dan", "swing:eve"],
  );
  assert.equal(views.length, HEADLINES_SHOWN);
});

test("the title race leads when it is the biggest story", () => {
  const table = [standing("ana", 1, 1505), standing("ben", 2, 1500)];
  const views = headlineViews([headline("thrashing", "cat", 45)], table, name, true);
  assert.deepEqual(
    views.map((v) => v.id),
    ["titleRace", "thrashing:cat"],
  );
});

test("finished seasons talk in the past tense", () => {
  const [view] = headlineViews([headline("heater", "ana", 50)], [], name, false);
  assert.match(view.text.line, /finished the season on 3 straight wins/);
});

test("every yearbook title has a name, a blurb and a stat", () => {
  for (const key of Object.keys(SUPERLATIVE_COPY) as SuperlativeKey[]) {
    const text = superlativeText({
      key,
      playerId: "ana",
      value: 2,
      extra: 1.5,
      label: "Napoli",
      games: 2,
    });
    assert.ok(text.title, key);
    assert.ok(text.line, key);
    assert.ok(text.stat && text.statLabel, key);
  }
});

test("a new signing is told how many games until a title", () => {
  const text = superlativeText({
    key: "newSigning",
    playerId: "ana",
    value: 1,
    extra: null,
    label: null,
    games: 1,
  });
  assert.equal(text.line, "2 more games to earn a title.");
});

test("a clean sweep reads differently from a lopsided record", () => {
  const base = {
    key: "oneSided" as const,
    playerId: "dan",
    otherId: "cat",
    games: 3,
    gf: 6,
    ga: 1,
    lastMatchId: "m1",
  };
  assert.match(feudText({ ...base, w: 3, d: 0, l: 0 }, name).line, /DAN has won all 3/);
  assert.match(feudText({ ...base, w: 2, d: 1, l: 0 }, name).line, /DAN has CAT's number/);
});
