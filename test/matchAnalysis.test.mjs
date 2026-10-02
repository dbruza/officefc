/* Unit tests for match-analysis prompt construction, JSON parsing, and the
   deterministic fallback: surprise classification boundaries, stats-aware copy,
   and the exact output shape shared with parseAnalysis. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseAnalysis,
} from "../functions/src/matchAnalysis/core/prompt.mjs";
import {
  classifySurprise,
  fallbackAnalysis,
} from "../functions/src/matchAnalysis/core/fallback.mjs";

function baseCtx(overrides = {}) {
  return {
    match: {
      aGoals: 2,
      bGoals: 1,
      aTeam: "Man Red",
      bTeam: "FC Blue",
      date: "2026-08-20",
      aEloBefore: 1500,
      aEloAfter: 1515,
      aDelta: 15,
      bEloBefore: 1500,
      bEloAfter: 1485,
      bDelta: -15,
      aStats: { possession: 55, shots: 10, shotsOnTarget: 6, xg: 1.8 },
      bStats: { possession: 45, shots: 8, shotsOnTarget: 3, xg: 0.9 },
    },
    playerA: { id: "alice", name: "Alice" },
    playerB: { id: "bob", name: "Bob" },
    seasonName: "Winter League",
    isFinals: false,
    eloExplain: {
      aExpected: 0.55,
      bExpected: 0.45,
      aTeamAdj: 24,
      bTeamAdj: -24,
      aPremierAdj: 0,
      bPremierAdj: 0,
      aK: 32,
      bK: 32,
    },
    seasonForm: null,
    headToHead: null,
    h2hNames: { a: "Alice", b: "Bob" },
    mvpName: null,
    ...overrides,
  };
}

test("system prompt demands bare JSON with the required keys", () => {
  for (const key of [
    "headline",
    "summary",
    "surpriseLevel",
    "surpriseNote",
    "ratingStory",
    "talkingPoints",
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(key), `prompt should mention ${key}`);
  }
});

test("buildUserPrompt quotes committed numbers, not invented ones", () => {
  const p = buildUserPrompt(baseCtx());
  assert.ok(p.includes("Alice (Man Red) 2–1 Bob (FC Blue)"));
  assert.ok(p.includes("1500 -> 1515"));
  assert.ok(p.includes("55%–45%"));
  assert.ok(p.includes("Expected goals (xG): 1.80–0.90"));
  assert.ok(p.includes("Pre-match win probability"));
  // K-factor note only when provisional
  assert.ok(!p.includes("provisional K-factor"));
});

test("buildUserPrompt flags provisional K and finals", () => {
  const ctx = baseCtx({
    isFinals: true,
    eloExplain: {
      aExpected: 0.6,
      bExpected: 0.4,
      aTeamAdj: 0,
      bTeamAdj: 0,
      aPremierAdj: 100,
      bPremierAdj: -100,
      aK: 40,
      bK: 32,
    },
  });
  const p = buildUserPrompt(ctx);
  assert.ok(p.includes("FINALS knockout tie"));
  assert.ok(p.includes("provisional K-factor"));
  assert.ok(p.includes("reigning premier") === false); // adj is in explain, prose mentions handicap only via team line
});

test("buildUserPrompt renders absent stats as missing rather than guessing", () => {
  const ctx = baseCtx();
  ctx.match.aStats = {};
  ctx.match.bStats = {};
  const p = buildUserPrompt(ctx);
  assert.ok(!p.includes("MATCH STATS"));
  assert.ok(!p.includes("Possession"));
});

test("parseAnalysis accepts clean JSON and coerces unknown surprise levels", () => {
  const out = parseAnalysis(
    '{"headline":"H","summary":"S","surpriseLevel":"banana","surpriseNote":"n","ratingStory":"r","talkingPoints":["a","b","c","d"]}',
  );
  assert.equal(out.surpriseLevel, "expected");
  assert.equal(out.talkingPoints.length, 3); // capped
});

test("parseAnalysis tolerates markdown fences around the object", () => {
  const out = parseAnalysis(
    'Sure! Here you go:\n```json\n{"headline":"H","summary":"S"}\n```\nEnjoy.',
  );
  assert.equal(out.headline, "H");
  assert.equal(out.surpriseLevel, "expected");
});

test("parseAnalysis rejects prose without any object", () => {
  assert.throws(() => parseAnalysis("no json at all"), /no JSON/);
  assert.throws(() => parseAnalysis('{"summary":"no headline"}'), /missing headline/);
});

test("classifySurprise boundary cases", () => {
  // Favourite won comfortably -> expected.
  assert.equal(classifySurprise(3, 0, 0.7), "expected");
  // Slight favourite lost -> mild_upset.
  assert.equal(classifySurprise(0, 1, 0.55), "mild_upset");
  // Underdog won big -> shock.
  assert.equal(classifySurprise(4, 0, 0.3), "shock");
  // Heavy favourite only drew -> mild_upset.
  assert.equal(classifySurprise(1, 1, 0.7), "mild_upset");
  // Even draw -> expected.
  assert.equal(classifySurprise(0, 0, 0.52), "expected");
});

test("fallback analysis names the winner and matches the parse shape", () => {
  const out = fallbackAnalysis(baseCtx());
  for (const key of [
    "headline",
    "summary",
    "surpriseLevel",
    "surpriseNote",
    "ratingStory",
    "talkingPoints",
  ]) {
    assert.ok(typeof out[key] !== "undefined" && out[key] !== null, `has ${key}`);
  }
  assert.equal(out.surpriseLevel, "expected"); // 0.55 favourite won
  assert.equal(out.headline.includes("Alice"), true);
  assert.equal(out.talkingPoints.length, 3);
});

test("fallback analysis calls a genuine upset a shock", () => {
  const ctx = baseCtx({
    match: {
      ...baseCtx().match,
      aGoals: 0,
      bGoals: 3,
      aDelta: -25,
      bDelta: 25,
      aStats: {},
      bStats: {},
    },
    eloExplain: {
      aExpected: 0.85,
      bExpected: 0.15,
      aTeamAdj: 0,
      bTeamAdj: 0,
      aPremierAdj: 0,
      bPremierAdj: 0,
      aK: 32,
      bK: 32,
    },
  });
  const out = fallbackAnalysis(ctx);
  assert.equal(out.surpriseLevel, "shock");
  assert.ok(out.headline.toLowerCase().includes("shock"));
  assert.ok(out.summary.includes("underdog"));
});
