# Firebase logging & performance observability — design

**Date:** 2026-06-15
**Status:** Draft (pending user review)

## Problem

The app has effectively no logging story. The backend has only 3 ad-hoc `console.*`
calls (`scheduled.ts`, `notify.ts`); the client has **zero** `console.*` calls and no
Crashlytics / Sentry / Analytics. There are no current errors to chase, but two needs
drive this work:

1. **Proactive coverage** — when issues *do* occur, we want logs already in place to
   troubleshoot them, ideally without needing physical access to a user's device.
2. **Slow loading** — a real, present pain. The slow surfaces are **app startup / sign-in**,
   the **leaderboard / standings**, and **profiles / match history** (the AI extraction path
   is expected to be slow and is out of scope). All three are client-side, Firestore-read-heavy
   paths that funnel through `mobile/src/lib/league.ts`.

## Goal & non-goals

**Goal:** a custom, hybrid logging layer feeding **Google Cloud Logging** — structured
backend logging plus a client logger that logs locally everywhere and forwards errors and
slow-operation warnings to the backend, with timing instrumentation on the slow read paths.

**Non-goals (v1):**
- True fatal-crash capture (needs a native crash reporter — see Future work).
- App Check / native attestation (needs native modules on Expo + JS SDK — see Future work).
- Rewriting `getHeadToHeadsForPlayer` — instrument it now, fix it as a separate follow-up.
- Firebase Performance Monitoring / Analytics / Remote Config — all **web-only** in the
  Firebase JS SDK; they don't run on React Native, so they're not viable cross-platform.

## Constraints discovered (drive the design)

- **No App Check** is configured anywhere (only a transitive lockfile dep). On Expo + the
  Firebase JS SDK, App Check is not a drop-in: ReCaptcha providers are web-only and native
  attestation needs native modules.
- **`index.ts` only re-exports already-constructed `onCall(...)` callables** — a wrapper
  applied at the export site cannot work. The wrapper must be applied where `onCall` is
  called, inside each domain module.
- **In-memory buffering is not crash reporting.** A fatal `ErrorUtils` handler usually
  terminates before an async callable flush completes; React error boundaries miss
  event-handler and most async errors; and unhandled-promise-rejection tracking in this RN
  version is dev-only on Hermes (`polyfillPromise.js:25`). Global capture is therefore
  **best-effort non-fatal reporting**, and must be described as such.
- **Mobile has no test runner** (`mobile/package.json` has no `test` script).
- The startup "ready" signal (`_layout.tsx:23`, `auth.tsx:54`) reflects only
  **profile + membership loaded**, not screen-specific data — so the startup metric is named
  accordingly.

## Architecture

Four units, each independently testable.

### 1. Backend — `loggedOnCall` factory (`functions/src/logging.ts`, new)

A factory wrapping v2 `onCall`, used **inside each domain module** in place of `onCall`:

```
loggedOnCall(name, options, handler)
```

- Forwards `options` to `onCall` unchanged (incl. `secrets`, region, memory, etc.).
- Emits **one structured completion event** per invocation (entry logging is `debug` only —
  the callable runtime already emits request logs with trace correlation, so a second
  always-on entry log is redundant volume):
  - success → `info`: `{ event: "callable_done", fn, uid, durationMs, outcome: "ok" }`
  - **expected** rejection (`HttpsError` with code `invalid-argument` / `not-found` /
    `permission-denied` / `unauthenticated` / `failed-precondition`) → `warn`:
    `{ event: "callable_done", fn, uid, durationMs, outcome: "rejected", code }`
  - **unexpected** throw → `logger.error` with the **actual `Error`** passed through (so the
    original stack is retained): `{ event: "callable_failed", fn, uid, durationMs }`
- Re-throws the original error unchanged in all cases.

Also: replace the 3 existing `console.*` calls with `firebase-functions/logger`.

This gives **per-callable latency + error visibility in Cloud Logging automatically** once
each module adopts `loggedOnCall`.

### 2. Backend — client log sink (`functions/src/clientLogs.ts`, new)

`ingestLog` callable — **authenticated-only in v1**:

- Requires `request.auth`; `request.auth.uid` is the **sole authoritative UID** (any client
  `uid` in the payload is ignored).
- Accepts a small batch `{ level, event, context, durationMs, clientTs }[]`.
- **Treats everything in the payload as untrusted:**
  - `level`/severity is clamped to an allowlist; clients cannot manufacture `error` freely
    above a per-UID rate limit.
  - enforces **batch-size cap**, **per-field length caps**, and a **total encoded-bytes cap**.
  - sanitizes `context`: bounded scalar values only, capped nesting depth and string length,
    redacts credential/token/email-like keys, rejects raw exception/`customData` objects.
  - validates `clientTs` for clock skew; stores it as `clientTs` (distinct from server time).
- **Rate-limits per UID.** Over-limit batches are dropped (logged once at `warn`).
- Re-emits each accepted entry via `firebase-functions/logger`, tagged
  `{ source: "client", uid, platform, appVersion }`. **No Firestore writes** — entries land
  straight in Cloud Logging (nothing to clean up, no document quota).

Pre-sign-in errors are **not** remotely captured in v1 (local-only until after auth). This
is an accepted trade-off; App Check would be required to safely accept unauthenticated
ingestion (Future work).

### 3. Client — logger (`mobile/src/lib/logger.ts`, new)

Split into a **pure core** (no RN/Firebase imports — leveling, sanitization, buffer/flush,
`timed()` timing logic) and a thin **adapter** (console, `expo-constants` version, current
`uid`, the `ingestLog` call). The pure core is unit-testable without RN.

- API: `logger.debug/info/warn/error(event, context?)`. Auto-tags `platform`, `appVersion`,
  `uid` (when available), and the current route/`screen`.
- **Local:** structured console output — `debug`/`info` gated behind `__DEV__`;
  `warn`/`error` always.
- **Remote (hybrid):** `warn` + `error` (incl. `slow_read` warnings) enter an in-memory
  buffer flushed to `ingestLog` on a size threshold / short interval. Fully **best-effort**:
  every forward is wrapped and swallowed (at most one local `console.warn` on flush failure),
  never throws, never blocks UI. Buffers before auth; flushes after sign-in; drops oldest on
  overflow.
- **Global capture (best-effort, non-fatal):** chain (not replace) the existing
  `ErrorUtils` global handler — install once, log, then **call the original handler** so the
  fatal path is never swallowed. Add a React error boundary at `app/_layout.tsx` for render
  errors. Documented limitation: fatal crashes usually won't flush in time, and async /
  event-handler errors may be missed.

### 4. Client — performance instrumentation

- **`timed(label, fn)`** (in the logger core): measures an async op's duration, logs `info`
  in dev, and emits a `warn` `slow_read` when it exceeds the threshold. Snapshots the
  **current route** at start, and records **result count** (and cache/source where practical).
- Wrap the reads behind the three slow screens, at the **`league.ts` boundary** (one localized
  change, no screen edits): `getActiveSeason`, `getStandings`, `getLeaguePlayers`,
  `getPlayerStats`, `getPlayerMatches`, `getHeadToHeadsForPlayer` and siblings. (All confirmed
  to exist and to be the reads behind those screens.)
- **`auth_bootstrap_ready`** startup metric: measured in `auth.tsx` / `_layout.tsx` as
  mount → profile+membership loaded. Named honestly (it is *not* "first screen data ready");
  per-screen readiness can be added later via an explicit signal from the initial screen.

## Configuration

- **Server caps** (batch size, per-field/total bytes, per-UID rate limit, skew tolerance)
  live server-side in `clientLogs.ts` — hard limits, not client-tunable.
- **Slow-read threshold** and batch/flush parameters live in a single client constant
  (`mobile/src/lib/constants.ts`), starting ~1500 ms, tunable as real numbers arrive.
- **Remote-logging rollout flag** is a **build-time `EXPO_PUBLIC_*` env var** (cross-platform).
  Remote Config is *not* used — it is web-only in the JS SDK. (A runtime kill-switch via
  Remote Config could be added for the web build only, later.)

## Error-handling philosophy

Logging is **observability, not behavior.** The remote path may fail silently and the app
must be unaffected: every forward is isolated and swallowed, the global handler always
defers to the original, and a logging failure never changes control flow or surfaces to the
user.

## Testing

- **Functions** (existing `functions/test` setup): `loggedOnCall` logs the success / expected-
  rejection / unexpected-error paths correctly, preserves return values, and re-throws
  unchanged; `ingestLog` enforces auth, caps (batch/field/bytes), sanitization/redaction, skew
  validation, and per-UID rate limiting.
- **Client** (new mobile test runner + `test` script): the pure logger core — leveling,
  buffer/flush batching, best-effort swallow, sanitization, and `timed()` duration + threshold
  logic with an **injected clock** (no `Date.now()` coupling).
- **Emulator check:** invoke a callable → confirm a single structured completion log; force a
  slow read → confirm a `slow_read` warning reaches `ingestLog`; invoke `ingestLog`
  unauthenticated → confirm rejection.

## Rollout (phased)

1. Backend `logging.ts` + adopt `loggedOnCall` across domain modules; replace the 3
   `console.*`. (Immediate Cloud Logging value, zero client risk.)
2. Client `logger.ts` (pure core + adapter) + best-effort global capture + mobile test runner.
3. `ingestLog` callable (authenticated-only, hardened) + wire the hybrid remote path behind
   the env flag. **Deploy the protected sink before enabling remote transport.**
4. `timed()` instrumentation on the `league.ts` reads + `auth_bootstrap_ready`.

## Future work (documented, out of scope)

- **Fatal crash reporting:** a native crash reporter (e.g. `@react-native-firebase/crashlytics`
  or `sentry-expo`) for reliable fatal capture — the only way to capture what step 2's
  best-effort path admits it can miss.
- **App Check + native attestation** (App Attest / Play Integrity), which would let `ingestLog`
  safely accept pre-sign-in / unauthenticated reports.
- **`getHeadToHeadsForPlayer` rewrite:** replace the full-collection read + JS filter with two
  parallel equality queries (matching the existing `getPlayerMatches` idiom). Split out as its
  own task with its own test; this project only instruments it.
- **Sentry** as an alternative/complement if Cloud Logging is outgrown (richer error grouping,
  breadcrumbs, source maps, native + web).
