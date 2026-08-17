import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { previewElo } from "./eloMath";

// The server's compiled math is the source of truth — importing it is what makes this a parity
// test rather than a restatement of the port. `npm test` in this package builds functions/lib
// first, so this can never validate against a stale or missing artifact. The compiled output is
// CommonJS, so load it via require.
const require = createRequire(import.meta.url);
const { calculateSeason } = require("../../../../functions/lib/elo.js") as {
  calculateSeason: (
    matches: Array<Record<string, unknown>>,
    memberIds: string[],
    seasonStartMillis: number,
    options?: { premierId?: string | null },
  ) => { matches: Array<ServerMatch> };
};

interface ServerMatch {
  id: string;
  aEloBefore: number;
  bEloBefore: number;
  aDelta: number;
  bDelta: number;
}

interface Fixture {
  name: string;
  aGoals: number;
  bGoals: number;
  aTeamOverall?: number | null;
  bTeamOverall?: number | null;
  aShotsOnTarget?: number | null;
  bShotsOnTarget?: number | null;
  aPossession?: number | null;
  bPossession?: number | null;
  premierId?: string | null;
  /** Matches each player has already played before the target. Drives the provisional K flip
   *  and, because those games move ratings, the non-1500 rating path. */
  gamesA?: number;
  gamesB?: number;
}

const FIXTURES: Fixture[] = [
  { name: "goals-only narrow win", aGoals: 1, bGoals: 0 },
  { name: "goals-only blowout", aGoals: 5, bGoals: 0 },
  { name: "draw", aGoals: 2, bGoals: 2 },
  {
    name: "team handicap, underdog wins",
    aGoals: 3,
    bGoals: 1,
    aTeamOverall: 70,
    bTeamOverall: 85,
  },
  {
    name: "team handicap, favourite wins",
    aGoals: 3,
    bGoals: 1,
    aTeamOverall: 85,
    bTeamOverall: 70,
  },
  {
    name: "full stats (SOT + possession)",
    aGoals: 2,
    bGoals: 1,
    aShotsOnTarget: 8,
    bShotsOnTarget: 2,
    aPossession: 65,
    bPossession: 35,
  },
  { name: "premier wins", aGoals: 3, bGoals: 1, premierId: "p1" },
  { name: "premier loses", aGoals: 1, bGoals: 3, premierId: "p1" },
  { name: "premier draws", aGoals: 2, bGoals: 2, premierId: "p2" },
  {
    name: "premier + team handicap stacked",
    aGoals: 1,
    bGoals: 1,
    aTeamOverall: 80,
    bTeamOverall: 85,
    premierId: "p1",
  },
  // --- K-factor: without these the settled K (32) is never exercised at all. ---
  { name: "settled K both sides", aGoals: 2, bGoals: 0, gamesA: 14, gamesB: 12 },
  { name: "K boundary: 9 games is still provisional", aGoals: 1, bGoals: 0, gamesA: 9, gamesB: 9 },
  { name: "K boundary: 10 games has settled", aGoals: 1, bGoals: 0, gamesA: 10, gamesB: 10 },
  // Mismatched K is where "B's delta is just -A's delta" stops being true.
  { name: "mixed K, provisional vs settled", aGoals: 3, bGoals: 2, gamesA: 2, gamesB: 12 },
  {
    name: "settled K with full stats and handicaps",
    aGoals: 4,
    bGoals: 2,
    aTeamOverall: 88,
    bTeamOverall: 74,
    aShotsOnTarget: 9,
    bShotsOnTarget: 5,
    aPossession: 58,
    bPossession: 42,
    premierId: "p2",
    gamesA: 11,
    gamesB: 15,
  },
  // --- Partial inputs: each term's "both sides known" gate. ---
  {
    name: "SOT known, possession absent",
    aGoals: 2,
    bGoals: 1,
    aShotsOnTarget: 7,
    bShotsOnTarget: 3,
  },
  { name: "possession known, SOT absent", aGoals: 2, bGoals: 1, aPossession: 70, bPossession: 30 },
  {
    name: "one-sided SOT is ignored by both",
    aGoals: 1,
    bGoals: 0,
    aShotsOnTarget: 6,
    bShotsOnTarget: null,
  },
  { name: "overall 0 is a real rating, not absent", aGoals: 1, bGoals: 1, aTeamOverall: 0 },
  {
    name: "one-sided overall disables the handicap",
    aGoals: 2,
    bGoals: 1,
    aTeamOverall: 85,
    bTeamOverall: null,
  },
];

const fixture = (name: string): Fixture => {
  const found = FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture named ${name}`);
  return found;
};

/**
 * Run a fixture through the real server season walk and return its committed match row.
 *
 * Each player's `games*` count is produced by genuine prior matches against throwaway
 * opponents, so the server's own game counter (and therefore its K) is driven the same way it
 * is in production — and the target match sees real, non-1500 ratings rather than seeded ones.
 */
function serverMatch(f: Fixture): ServerMatch {
  const matches: Array<Record<string, unknown>> = [];
  const members = new Set(["p1", "p2"]);
  let clock = 0;

  const warmUp = (uid: string, count: number, tag: string) => {
    for (let i = 0; i < count; i++) {
      const filler = `filler_${tag}${i}`;
      members.add(filler);
      matches.push({
        id: `${tag}${i}`,
        aId: uid,
        bId: filler,
        // Alternate the result so the player's rating actually moves rather than hovering.
        aGoals: i % 2 === 0 ? 2 : 0,
        bGoals: i % 2 === 0 ? 1 : 1,
        dateMillis: ++clock,
      });
    }
  };
  warmUp("p1", f.gamesA ?? 0, "wa");
  warmUp("p2", f.gamesB ?? 0, "wb");

  matches.push({
    id: "target",
    aId: "p1",
    bId: "p2",
    aGoals: f.aGoals,
    bGoals: f.bGoals,
    dateMillis: ++clock,
    aShotsOnTarget: f.aShotsOnTarget,
    bShotsOnTarget: f.bShotsOnTarget,
    aPossession: f.aPossession,
    bPossession: f.bPossession,
    aTeamOverall: f.aTeamOverall,
    bTeamOverall: f.bTeamOverall,
  });

  const result = calculateSeason(matches, [...members], 0, { premierId: f.premierId ?? null });
  const target = result.matches.find((m) => m.id === "target");
  if (!target) throw new Error(`server dropped the target match for ${f.name}`);
  return target;
}

test("previewElo matches the server's committed delta, from both players' perspectives", () => {
  for (const f of FIXTURES) {
    const server = serverMatch(f);

    const asA = previewElo(
      server.aEloBefore,
      server.bEloBefore,
      f.aGoals,
      f.bGoals,
      f.aTeamOverall,
      f.bTeamOverall,
      f.gamesA ?? 0,
      f.premierId ?? null,
      "p1",
      "p2",
      {
        myShotsOnTarget: f.aShotsOnTarget,
        opponentShotsOnTarget: f.bShotsOnTarget,
        myPossession: f.aPossession,
        opponentPossession: f.bPossession,
      },
    );
    assert.equal(asA, server.aDelta, `A-side preview mismatch: ${f.name}`);

    // Asserted against the server's own bDelta, NOT against -aDelta: the two are not mirrors
    // once the players' K factors differ, and the server's B branch deserves its own guard.
    const asB = previewElo(
      server.bEloBefore,
      server.aEloBefore,
      f.bGoals,
      f.aGoals,
      f.bTeamOverall,
      f.aTeamOverall,
      f.gamesB ?? 0,
      f.premierId ?? null,
      "p2",
      "p1",
      {
        myShotsOnTarget: f.bShotsOnTarget,
        opponentShotsOnTarget: f.aShotsOnTarget,
        myPossession: f.bPossession,
        opponentPossession: f.aPossession,
      },
    );
    assert.equal(asB, server.bDelta, `B-side preview mismatch: ${f.name}`);
  }
});

test("the K factor genuinely flips at PROVISIONAL_GAMES", () => {
  // Guards the fixtures above from silently degenerating: if every case ran at the same K, the
  // suite would still pass while leaving one of the two constants completely untested.
  const provisional = serverMatch(fixture("K boundary: 9 games is still provisional"));
  const settled = serverMatch(fixture("K boundary: 10 games has settled"));
  assert.notEqual(
    provisional.aDelta,
    settled.aDelta,
    "9 and 10 prior games must produce different deltas, or the K flip is untested",
  );
});

test("previewElo tracks the server when the two players carry different K factors", () => {
  const f = fixture("mixed K, provisional vs settled");
  const server = serverMatch(f);
  // The case that disproves "B's delta is the mirror of A's" — asserted explicitly so nobody
  // reintroduces the shortcut.
  assert.notEqual(
    server.bDelta,
    -server.aDelta,
    "fixture no longer exercises mismatched K; pick counts that straddle PROVISIONAL_GAMES",
  );
});
