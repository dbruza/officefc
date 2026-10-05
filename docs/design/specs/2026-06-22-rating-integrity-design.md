# Rating Integrity (D1–D4) — Design

Date: 2026-06-22 · Slice 1 of the OfficeFC improvement roadmap (Theme D).

## Goal

Four surgical fairness fixes to the seasonal ELO engine, plus the UI surfaces that
expose them. All engine logic stays in `functions/src/elo.ts` as pure, deterministic
functions covered by `test/elo.test.mjs`.

**Invariant preserved:** matches are processed sorted by `dateMillis` then `id`. Only the
standings comparator, the K-factor, and the fields emitted per match change.

## Out of scope (explicit)

- D5 rating decay / inactivity (season ELO still resets to `BASE_ELO`).
- Multi-league (`LEAGUE_ID` stays hardcoded).
- Head-to-head as a tie-break (we use goal difference instead).
- Per-league performance-weight toggle (weights stay fixed at 0.6 / 0.25 / 0.15).

## Decisions (locked)

| Item | Decision |
|------|----------|
| D1 min games | `MIN_RANKED_GAMES = 3`. Players with 1–2 games stay in standings as **provisional** (`ranked: false`, `rank: 0`, shown as "Placement n/3"). 0-game members remain excluded from standings (existing leaderboard "Unranked" bucket). |
| D2 tie-break | `compareStandings`: ELO desc → goal diff (`gf-ga`) desc → wins desc → fewer games (`w+d+l`) asc → `uid`. No head-to-head. |
| D3 provisional K | `PROVISIONAL_K = 40` for a player's first `PROVISIONAL_GAMES = 10` games **this season**, else `ELO_K = 32`. Applied in `calculateSeason` and `computePOTM`. |
| D4 explanation | Per-match `eloExplain` object persisted on the match doc; `match/[id].tsx` renders a "Why your ELO moved" panel. Weights stay fixed; README documents the blend. |

## Engine changes — `functions/src/elo.ts`

New exports:

```ts
export const MIN_RANKED_GAMES = 3;
export const PROVISIONAL_K = 40;
export const PROVISIONAL_GAMES = 10;

export function getK(gamesPlayedBefore: number): number; // 40 for <10, else 32

export interface EloExplain {
  aExpected: number; bExpected: number;  // expected score each side (0..1)
  perfA: number; perfB: number;          // performance blend (perfB = 1 - perfA)
  aTeamAdj: number; bTeamAdj: number;    // team-OVR handicap points applied to each side
  aK: number; bK: number;                // K used for each side's delta
}

export function compareStandings(a: Standing, b: Standing): number;
```

- `Standing` gains `ranked: boolean`.
- `CalculatedMatch` gains `eloExplain: EloExplain`.
- `calculateSeason`:
  - Track each player's prior game count; `aDelta` uses `getK(aGamesBefore)`, `bDelta`
    uses `getK(bGamesBefore)` (deltas may now be asymmetric when one side is provisional —
    intended).
  - Build `eloExplain` per match from the values already computed (`expectedScore`,
    `performanceScore`, team handicap, K).
  - Standings: keep the `w+d+l > 0` filter; set `ranked = (w+d+l) >= MIN_RANKED_GAMES`.
    Sort **ranked-first** then `compareStandings`; assign sequential `rank` only to ranked
    rows (provisional keep `rank: 0`).
- `computePOTM`: track per-player game count and use `getK` for monthly-gain deltas.

## Persistence — `functions/src/recalc.ts`

- `recalcSeasonElo` already spreads `...standing`, so `ranked` flows to standings docs
  automatically.
- Add `eloExplain` to the per-match merge write alongside `aEloBefore/After/Delta`.

## Consistency fixes

- **`finalizeSeason`** (`seasonAdmin.ts`): filter standings to `rank >= 1` before choosing
  champion/runner-up, so a provisional (`rank: 0`) player can't sort to the front and win.
- **`weeklySnapshot`** (`scheduled.ts`): iterate `result.standings`, skip `!ranked`, and use
  `standing.rank` (the engine's rank) for snapshot rows and `move` — provisional players get
  no rank row and no move arrow.

## Mobile surfaces

- **Types** (`mobile/src/lib/league/*`): add `ranked` to `Standing`, add `eloExplain` to the
  match type.
- **`leaderboard.tsx`**: three tiers — Ranked table (`standings.filter(ranked)`), new
  **Placement** section (`standings.filter(!ranked)`, shows "n/3"), and the existing
  **Unranked** bucket (members with no standing = 0 games).
- **`index.tsx`** (home Top-3): filter to `ranked` only.
- **`match/[id].tsx`**: "Why your ELO moved" panel from `eloExplain` — expected %, match
  quality %, opponent rating, team handicap, K (with "placement" label when 40).

## Tests — `test/elo.test.mjs`

New cases (test-first):

1. D1: a member with <3 games is provisional (`ranked: false`, `rank: 0`); ranked players get
   sequential ranks skipping provisional; a 0-game member is absent from standings.
2. D2: `compareStandings` orders by ELO → GD → wins → fewer games → uid (one assertion per
   rung).
3. D3: `getK(0/9) === 40`, `getK(10/11) === 32`; a fresh match's delta uses K=40; an 11th game
   uses K=32 (verified against `expectedScore`/`performanceScore` on the reported `eloBefore`).
4. D4: `calculateSeason` emits `eloExplain` with correct expected/perf/teamAdj/K.
5. Regression: the 5 existing `performanceScore`/`calculateSeason` tests still pass.

Run: `npm test` (builds `functions/` then runs `node --test test/*.test.mjs`).

## Rollout

Engine changes only materialize on recalc. `recalcSeasonElo` fires on every confirmed match;
to backfill the active season immediately, run the admin recalc/`rebuildLeagueReadModels` path
post-deploy so existing standings carry `ranked` and matches carry `eloExplain` (consistent with
the project's prod-migration pattern).
