# A1 — League Activity Feed — Design

**Status:** approved (2026-06-23)
**Roadmap item:** A1 (Theme A — Engagement)
**Depends on:** rating integrity D1–D4 (shipped) — uses `eloBefore`/`ranked` already on matches/standings.

## Goal

Give the league a shared, newest-first feed of what's happening — results, milestones,
upsets, lead changes, and season awards — so there's a reason to open the app between
your own matches. v1 is **in-app only** (no push; push waits for C4 notification prefs).

## Architecture & data model

A new Firestore collection `activity/{eventId}`, written **only** by Cloud Functions
(Admin SDK), read by league members. This mirrors the existing
`playerStats`/`h2h`/`standings` pattern: members read, functions write.

```
activity/{eventId}
  type: "match_result" | "upset" | "streak" | "new_number_one" | "potm" | "champion"
  leagueId: "office"          // stored for future multi-league; NOT queried in v1
  seasonId: string | null
  createdAt: Timestamp        // serverTimestamp on live emit; match time on backfill — sort key
  actorIds: string[]          // players involved (future "your activity" filter)
  payload: { … }              // type-specific facts, uids only (NO denormalized names)
```

**Payloads store uids + facts, never names.** The home tab already loads the roster map,
so the client resolves uids → names itself — no stale name copies in the feed docs.

**Deterministic doc IDs** make every write idempotent:

| type | id | payload |
|------|----|---------|
| `match_result` | `result_<matchId>` | `{ matchId, aId, bId, aGoals, bGoals, aDelta, bDelta }` |
| `upset` | `upset_<matchId>` | `{ matchId, winnerId, loserId, winnerEloBefore, loserEloBefore, gap }` |
| `streak` | `streak_<matchId>_<uid>` | `{ playerId, count }` |
| `new_number_one` | `numberone_<matchId>` | `{ playerId, previousLeaderId }` |
| `potm` | `potm_<seasonId>_<month>` | `{ playerId, month, gain }` |
| `champion` | `champion_<seasonId>` | `{ playerId, runnerUpId, seasonName }` |

Re-running a recalc or the backfill re-derives the same IDs, so duplicates are impossible.

**Rules:** `match /activity/{eventId} { allow read: if isMember(); allow write: if false; }`.
**Indexes:** none. The only query is single-field `orderBy(createdAt desc) limit N`
(Firestore auto-indexes single fields). No `leagueId` filter in v1 (single league),
so no composite index.

## Event production

A **pure, unit-tested** module `functions/src/activity.ts` (no firebase-admin imports —
same discipline as `elo.ts`) does all the derivation; a thin IO module
`functions/src/activityFeed.ts` reads the inputs and persists the results.

`deriveMatchActivity(input): ActivityEvent[]` — for one confirmed match:
- **match_result** — always.
- **upset** — only when there's a winner and `loserEloBefore - winnerEloBefore >= 100`.
- **streak** — only when the winner's post-recalc win streak hits a milestone (3 / 5 / 10).
- **new_number_one** — only when the season's rank-1 ranked player changed
  (`newLeaderId && newLeaderId !== previousLeaderId`).

`deriveSeasonActivity(input): ActivityEvent[]` — `champion` + one `potm` per month.

**Emission points** (IO):
- `confirmMatch` and `resolveMatch` (admin confirm/correct) — after the existing inline
  `recalcSeasonElo` + `recalcLeagueStats`. The previous leader is captured **before**
  recalc; the match deltas, winner streak, and new leader are read **after**. One emit per
  confirmation. Disputes/voids emit nothing (the feed stays positive).
- `finalizeSeason` — `champion` + `potm` events.

**Idempotency:** each confirmation runs the emit exactly once (a second confirm throws
`failed-precondition`), and deterministic IDs are the safety net.

## Backfill

A one-off, nonce-guarded `onRequest` (`functions/src/migrations/backfillActivityFeed.ts` —
the project's established migration pattern) writes `result_<matchId>` events for the ~20
most recent confirmed matches, with `createdAt` set to each match's confirm/match time so
the seeded feed is chronological. It skips events that already exist, so it is safe to run
alongside live `confirmMatch` writes. Computed events (streak/upset/#1) start fresh from
deploy; they are not backfilled. The file is deleted after the one run, like
`backfillSeasonCodes`.

## Mobile

- `mobile/src/lib/league/types.ts` — `ActivityType`, `ActivityEvent`.
- `mobile/src/lib/league/activity.ts` — `getRecentActivity(limit = 20)`:
  `query(collection(db,'activity'), orderBy('createdAt','desc'), limit(limit))`, mapped
  newest-first. No realtime, no cursor pagination in v1 — the component reveals more from
  the already-fetched 20 via a "Show more" toggle.
- `mobile/src/components/ActivityFeed.tsx` — renders each event by type (type icon +
  one-line copy + relative time), resolving uids → names from the roster map. Shows the
  first 6 with a "Show more" toggle. Warm empty state when there are no events.
- `mobile/app/(app)/index.tsx` — fetch `getRecentActivity(20)` in the existing `load()`
  Promise.all; render the feed section below "Top of the table." No home restructure.

## Testing

- `test/activity.test.mjs` (pure, like `elo.test.mjs`, imports `functions/lib/activity.js`):
  result always emitted; upset only at a ≥100 gap and only for the winner; streak only on a
  3/5/10 crossing; new-#1 only on a genuine leader change (and not when unchanged or when
  there's still no ranked leader); deterministic IDs are stable; season events derive
  champion + per-month POTM.
- Existing `firestore` rules tests get an `activity` read/write case if the rules suite
  covers new collections.

## Out of scope (v1)

Push notifications (C4), unread/seen badges, realtime subscription, cursor pagination,
the full home-screen restructure (C1), and "void/dispute" feed events.
