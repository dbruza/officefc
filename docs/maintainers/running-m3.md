# Running M3 locally

> Historical milestone runbook. For the current setup and release state, see
> [Firebase setup](../firebase-setup.md) and the
> [implementation overview](implementation-plan.md).

M3 adds the read-heavy league experience on top of the M2 match lifecycle:

1. player profiles with current-season ELO history and all-time records;
2. head-to-head summaries with recent meeting links;
3. confirmed match detail;
4. season and Hall of Fame surfaces;
5. bottom-tab navigation and richer dashboard stats.

## Start the local stack

From the repo root:

```bash
firebase emulators:start
```

From `mobile/`:

```bash
npm run web
```

The app runs at `http://localhost:8081` and the Emulator UI at
`http://127.0.0.1:4000`.

## Backfill existing M2 data

M3 materializes all-time documents after every future match confirmation:

- `playerStats/{uid}`;
- `h2h/{sortedUidPair}`.

Existing confirmed emulator or deployed matches need one backfill. Sign in as an
admin and open the dashboard; when standings exist but the current player's M3
stats do not, the app calls the admin-only `rebuildLeagueReadModels` function.

The callable recalculates every season represented by confirmed matches, then
rebuilds the all-time player and head-to-head documents.

## M3 smoke test

1. Open the dashboard and confirm the season ELO, streak, and table render.
2. Open **Table**, search for a player, then open their profile.
3. Confirm the ELO chart, record, form, biggest win, and matchup list.
4. Open a matchup, then open one of its recent meetings.
5. Confirm the match score, ELO changes, teams, and manual/AI stats state.
6. Open **Seasons** and confirm the active season and archive empty state.

Past-season cards and frozen archive tables are populated by the implemented
season-finalization snapshots.

## Verification commands

```bash
npm test
npm --prefix functions test
npm --prefix mobile run typecheck
npm --prefix mobile run export:web
```

With the Firestore emulator running:

```bash
npm --prefix test/rules test
```
