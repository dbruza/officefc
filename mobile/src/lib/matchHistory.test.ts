import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "./matchHistory";
import { friendlyError } from "./friendlyError";
import { timeAgo } from "./when";
import type { LeagueMatch } from "./league";

const ME = "me";

let seq = 0;
function match(opts: {
  opponent: string;
  mine: string;
  theirs: string;
  day: number;
  away?: boolean;
}): LeagueMatch {
  seq += 1;
  const { opponent, mine, theirs, day, away = false } = opts;
  return {
    id: `m${seq}`,
    seasonId: "s1",
    submittedBy: ME,
    aId: away ? opponent : ME,
    bId: away ? ME : opponent,
    aTeamId: away ? theirs : mine,
    bTeamId: away ? mine : theirs,
    aTeam: away ? theirs : mine,
    bTeam: away ? mine : theirs,
    aGoals: 1,
    bGoals: 0,
    status: "confirmed",
    source: "manual",
    date: new Date(2026, 8, day),
    photoPath: null,
    aEloBefore: null,
    aEloAfter: null,
    aDelta: null,
    bEloBefore: null,
    bEloAfter: null,
    bDelta: null,
  };
}

test("summarizes opponents by recency and count, from either side", () => {
  const history = summarizeHistory(
    [
      match({ opponent: "sam", mine: "ars", theirs: "che", day: 1 }),
      match({ opponent: "ali", mine: "liv", theirs: "rma", day: 3, away: true }),
      match({ opponent: "sam", mine: "ars", theirs: "psg", day: 5 }),
    ],
    ME,
  );
  assert.equal(history.opponents.get("sam")?.count, 2);
  assert.equal(history.opponents.get("sam")?.lastAt, new Date(2026, 8, 5).getTime());
  // Their teams newest first, distinct.
  assert.deepEqual(history.opponents.get("sam")?.teamIds, ["psg", "che"]);
  assert.deepEqual(history.opponents.get("ali")?.teamIds, ["rma"]);
  // My teams newest first, distinct — the first is the "last used" default.
  assert.deepEqual(history.myTeamIds, ["ars", "liv"]);
});

test("ignores matches the player wasn't in", () => {
  const other = { ...match({ opponent: "sam", mine: "x", theirs: "y", day: 2 }), aId: "zed" };
  const history = summarizeHistory([other], ME);
  assert.equal(history.opponents.size, 0);
  assert.deepEqual(history.myTeamIds, []);
});

test("friendlyError keeps deliberate server sentences and hides raw codes", () => {
  const precondition = Object.assign(new Error("This match is no longer pending."), {
    code: "functions/failed-precondition",
  });
  assert.equal(friendlyError(precondition, "fallback"), "This match is no longer pending.");
  const internal = Object.assign(new Error("internal"), { code: "functions/internal" });
  assert.equal(friendlyError(internal, "fallback"), "fallback");
  const offline = Object.assign(new Error("x"), { code: "functions/unavailable" });
  assert.match(friendlyError(offline, "fallback"), /offline/);
});

test("timeAgo reads naturally at each scale", () => {
  const now = new Date(2026, 9, 1, 12, 0).getTime();
  assert.equal(timeAgo(now - 30_000, now), "just now");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5m ago");
  assert.equal(timeAgo(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(timeAgo(now - 30 * 3_600_000, now), "yesterday");
  assert.equal(timeAgo(now - 4 * 86_400_000, now), "4d ago");
});
