import test from "node:test";
import assert from "node:assert/strict";
import { checkScore, deriveShotsOnTarget } from "./statsCheck";

// The server's module is the source of truth — importing it is what makes this a parity test.
// `npm test` in this package builds functions/lib first. The core modules compile to ESM, and
// this package's tests run as CommonJS, so load it with a dynamic import (no top-level await).
interface ServerStatsCheck {
  checkScoreConsistency: (
    home: Record<string, number | null>,
    away: Record<string, number | null>,
  ) => { status: string };
  deriveShotsOnTarget: (side: Record<string, number | null>) => { value: number | null };
}
const serverModule =
  import("../../../../functions/lib/extract/core/statsCheck.mjs") as Promise<ServerStatsCheck>;

/** Small deterministic PRNG so the sweep is reproducible. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

test("checkScore agrees with the server on 5,000 random reads (incl. missing values)", async () => {
  const server = await serverModule;
  const rand = rng(27);
  const maybe = (n: number) => (rand() < 0.15 ? null : n);
  for (let i = 0; i < 5000; i++) {
    const mine = {
      goals: maybe(Math.floor(rand() * 8)),
      shotsOnTarget: maybe(Math.floor(rand() * 14)),
      saves: maybe(Math.floor(rand() * 12)),
    };
    const theirs = {
      goals: maybe(Math.floor(rand() * 8)),
      shotsOnTarget: maybe(Math.floor(rand() * 14)),
      saves: maybe(Math.floor(rand() * 12)),
    };
    const expected = server.checkScoreConsistency(
      { goals: mine.goals, shots_on_target: mine.shotsOnTarget, saves: mine.saves },
      { goals: theirs.goals, shots_on_target: theirs.shotsOnTarget, saves: theirs.saves },
    ).status;
    assert.equal(checkScore(mine, theirs).status, expected, JSON.stringify({ mine, theirs }));
  }
});

test("deriveShotsOnTarget agrees with the server", async () => {
  const server = await serverModule;
  for (let shots = 0; shots < 40; shots++) {
    for (const accuracy of [0, 33, 50, 67, 82, 83, 100]) {
      assert.equal(
        deriveShotsOnTarget(shots, accuracy),
        server.deriveShotsOnTarget({ shots, shots_on_target: null, shot_accuracy: accuracy }).value,
      );
    }
  }
});

test("the real FC 27 read (City 3–1 Arsenal) passes; a misread 8–1 is caught", () => {
  const arsenal = { goals: 1, shotsOnTarget: 10, saves: 6 };
  assert.equal(checkScore({ goals: 3, shotsOnTarget: 9, saves: 8 }, arsenal).status, "ok");
  const misread = checkScore({ goals: 8, shotsOnTarget: 9, saves: 8 }, arsenal);
  assert.equal(misread.status, "mismatch");
  assert.deepEqual(misread.mine, { goals: 8, implied: 3, ok: false });
});
