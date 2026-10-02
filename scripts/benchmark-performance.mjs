import { calculateSeason } from "../functions/lib/elo.js";
import { changedFields } from "../functions/lib/modelWriter.js";
import { performance } from "node:perf_hooks";
const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
const input = Array.from({ length: 1000 }, (_, i) => ({
  id: `m${i}`,
  aId: ids[i % 20],
  bId: ids[(i + 1) % 20],
  aGoals: 2,
  bGoals: 1,
  dateMillis: 1700000000000 + i * 60000,
}));
const prior = calculateSeason(input, ids, 1690000000000);
const start = performance.now();
const next = calculateSeason(
  [...input, { ...input[0], id: "new", dateMillis: 1800000000000 }],
  ids,
  1690000000000,
);
const durationMs = performance.now() - start;
const old = new Map(prior.matches.map((m) => [m.id, m]));
const changed = next.matches.filter((m) => changedFields(old.get(m.id), m));
if (changed.length !== 1 || changed[0].id !== "new")
  throw new Error("Append-only replay changed historical ratings.");
console.log(
  JSON.stringify({
    matches: next.matches.length,
    changedMatchWrites: changed.length,
    calculationMs: durationMs,
  }),
);
