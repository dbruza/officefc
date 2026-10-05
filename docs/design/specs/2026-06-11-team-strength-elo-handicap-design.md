# Team-strength ELO handicap — design

**Date:** 2026-06-11
**Status:** Approved

## Problem

The team catalogue now carries per-team ratings (`overall/attack/midfield/defence`,
catalogue version `fifa23-men-v3`), but the ELO calculation ignores them entirely.
`performanceScore` blends only goals/shots-on-target/possession, and `expectedScore`
uses only the two players' current Elo. We want a team's strength to influence how much
Elo a player gains or loses, and we want every confirmed match so far this season replayed
under the new model.

## Decisions

- **Mechanism:** handicap the *expected score*. Fold the team-overall gap into each side's
  effective rating for the expectation only. Beating a stronger opponent while using a
  weaker team earns more; winning with the favourite earns less.
- **Strength:** `TEAM_ELO_PER_OVERALL = 12` Elo points per FIFA-overall point. A 15-overall
  gap ≈ 180 effective Elo ≈ 74% expected. (Initially shipped at 7; raised to 12 on
  2026-06-11 after reviewing the first backfill — the league wanted team choice to bite harder.)
- **Rating field:** the team `overall` (not the attack/mid/def blend).
- **Missing rating:** if *either* team's `overall` is missing (custom team with
  `overall: null`, or an unresolvable team id), apply **no** handicap for that match —
  identical to today's behaviour.

## Formula

For a match with players A, B at pre-match ratings `aElo`, `bElo`, and team overalls
`aOvr`, `bOvr`:

```
if aOvr != null and bOvr != null:
    effA = aElo + 12 * aOvr
    effB = bElo + 12 * bOvr
else:
    effA = aElo
    effB = bElo

aDelta = round(K * (perfA       - expectedScore(effA, effB)))
bDelta = round(K * ((1 - perfA) - expectedScore(effB, effA)))
```

The team bonus affects only the expectation. The stored `aEloBefore/aEloAfter` remain the
**true** player Elo — the team bonus never accumulates into a rating. `expectedScore` and
`performanceScore` are unchanged.

## Changes

### `functions/src/elo.ts`
- Add `export const TEAM_ELO_PER_OVERALL = 12`.
- Extend `SeasonMatchInput` with `aTeamOverall?: number | null` and
  `bTeamOverall?: number | null`.
- Add a private helper `effectiveRatings(aElo, bElo, aOvr, bOvr)` returning `[effA, effB]`
  with the null-fallback rule above.
- Use it for the expectation in both `calculateSeason` and `computePOTM` so they can't
  drift.

### `functions/src/recalc.ts`
- In `recalcSeasonElo`, collect `aTeamId/bTeamId` from the season's match snapshots,
  batch-read `teams/{id}` docs, build an `id → overall` map, and merge
  `aTeamOverall/bTeamOverall` into each `SeasonMatchInput`. Missing doc / `overall: null`
  → leave undefined (no handicap).
- `utils.ts` (`seasonMatchInputFromDoc`) stays unchanged; recalc reads team ids directly
  from the snapshots.

### No other code paths
- The live confirm path (`matchLifecycle.ts`) already calls `recalcSeasonElo`, so new
  matches get the handicap automatically.
- `computePOTM` is driven from the same inputs; the POTM recompute path must also pass
  team overalls (verify caller in `scheduled.ts`).

## Backfill (part 2)

No new migration code. The existing admin-only `rebuildLeagueReadModels` callable
(wired to a button in `mobile/app/(app)/index.tsx`) loops every season through
`recalcSeasonElo` + `recalcLeagueStats`. After deploy, an admin runs it once and every
confirmed match across all seasons is rewritten (deltas, standings, `eloHistory`).

## Team-id resolution (verified)

`seedTeamCatalogue` marks superseded catalogue teams inactive with `merge: true`, so their
`overall` is **preserved** — historical matches referencing old ids still resolve. Only
women's teams are hard-deleted, and custom teams have `overall: null`; both fall back to
no-handicap as designed.

## Tests

`functions/test/elo.test.js` — existing `aDelta: 8` / `0` assertions change. Add:
- handicap applied when both overalls present (underdog win gains more than favourite win
  at equal player Elo);
- no handicap when either overall is null/missing (matches pre-change deltas);
- symmetry (`aDelta`/`bDelta` consistent).

`functions/test/potm.test.js` — confirm POTM still computes with team overalls threaded in.
