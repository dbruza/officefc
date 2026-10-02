# Firebase Setup

OfficeFC uses Firebase Authentication, Firestore, Storage, Cloud Functions, Hosting, and
the local Emulator Suite.

## Requirements

- Node.js 24
- Java 21
- A Firebase project on the Blaze plan for deployed Functions and Storage

The Firebase CLI is pinned in the root development dependencies, so use it through `npx`
or the repository scripts.

## Create The Project

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com).
2. Enable email/password Authentication.
3. Create Firestore and Storage in the same region.
4. Register a Firebase web app.
5. Copy `mobile/.env.example` to `mobile/.env`.
6. Paste the web app configuration into the matching `EXPO_PUBLIC_FIREBASE_*` variables.

Firebase web configuration is public client metadata, not a secret. Authorization is
enforced by `firestore.rules`, `storage.rules`, and trusted Cloud Functions.

### Storage Rules And Firestore

`storage.rules` checks league membership with `firestore.exists()`. In deployed
environments, the Firebase Storage service account
`service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com` must have the
**Firebase Rules Firestore Service Agent**
(`roles/firebaserules.firestoreServiceAgent`) role. Without it, valid member uploads fail
with `storage/unauthorized` even though the same rules pass in the local emulators.

The Firebase console or CLI normally offers to enable this permission when cross-service
Storage Rules are first deployed. You can verify the grant in Google Cloud IAM by enabling
**Include Google-provided role grants**.

## Connect The CLI

From the repository root:

```bash
npx firebase login
npx firebase use --add
```

Choose the project and assign the `default` alias. The production deployment scripts
explicitly target the `office-fc` project.

## Local Development

Set this value in `mobile/.env`:

```dotenv
EXPO_PUBLIC_USE_EMULATORS=1
```

Start the emulators:

```bash
npx firebase emulators:start
```

In another terminal:

```bash
npm --prefix mobile run web
```

The Emulator UI is available at <http://localhost:4000>. Default service ports are defined
in `firebase.json`.

## Verify Security Rules

Install the rules-test workspace and run the emulator-backed suite:

```bash
npm --prefix test/rules ci
npm run test:rules
```

These tests cover league membership boundaries, trusted match fields, onboarding reads,
team validation, and private match-photo access.

## Logging & Observability

Logs land in **Google Cloud Logging** (Logs Explorer for the deployed project; the Emulator
UI shows the same entries locally).

- **Cloud Functions:** every callable is wrapped by `loggedOnCall` (`functions/src/logging.ts`),
  which emits one structured `callable_done` event per invocation with `jsonPayload.fn`,
  `outcome` (`ok` / `rejected`), and `durationMs`. Expected `HttpsError` rejections
  (`invalid-argument`, `not-found`, `permission-denied`, …) log at `warning`; unexpected
  throws log at `error` with the original stack. Filter by `jsonPayload.fn` to trace one
  callable's latency and failures.
- **Client:** the app logs through `mobile/src/lib/logger`. Everything prints to the local
  console; `warn`/`error` (including `slow_read` warnings from the instrumented league reads
  and the `auth_bootstrap_ready` timing) are also forwarded to the authenticated `ingestLog`
  callable, which re-emits them with `jsonPayload.source="client"`. Filter Logs Explorer on
  `jsonPayload.source="client"` to see device-reported issues, keyed by the authenticated
  `uid`.
- **Enabling client forwarding:** set `EXPO_PUBLIC_REMOTE_LOGGING=1` in `mobile/.env`. It
  defaults to `0`. Deploy the backend (so `ingestLog` exists) **before** enabling it.
  `ingestLog` is authenticated-only and rate-limited; pre-sign-in client errors stay local
  until the user signs in.
- **Tuning:** the slow-read threshold and batch/flush sizes live in
  `mobile/src/lib/logger`; the server-side caps (batch size, byte limits, per-uid rate limit)
  live in `functions/src/clientLogs`.

### Sentry crash and fault reporting

Sentry sits alongside Cloud Logging (added in v1.1.0.0):

- **Mobile** (`mobile/src/lib/sentry.ts`): captures native and fatal JS crashes, render
  errors, and error-level log events; every log entry also becomes a breadcrumb. Configure
  with `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENV` (`mobile/.env` for local dev
  and the web deploy, `mobile/eas.json` for native builds). Disabled in dev builds.
- **Functions** (`functions/src/sentry.ts`): callables report unexpected server faults
  with function name, uid, and duration; scheduled jobs and Firestore triggers report with
  the function name (expected `HttpsError` rejections are never sent, and the one-off
  `backfillSeasonCodes` migration endpoint is not instrumented). Configure with
  `SENTRY_DSN` in `functions/.env` on the deploying machine (copy
  `functions/.env.example`). Disabled in the emulator.
- **Dormant by default:** DSNs are public identifiers, not secrets, but they ship empty.
  With no DSN, captures no-op and a `sentry_disabled` warning is logged so the dormant
  state stays visible.
- **Source maps:** `mobile/metro.config.js` wraps the Expo Metro config so bundles carry
  debug IDs. Automatic source-map upload is off in every EAS profile
  (`SENTRY_DISABLE_AUTO_UPLOAD=true` in `mobile/eas.json`); symbolicated native releases
  need a `SENTRY_AUTH_TOKEN` **and** that flag removed or set to `false`.

Future hardening — App Check for the `ingestLog` sink — is documented in
`docs/superpowers/specs/2026-06-15-firebase-logging-observability-design.md`. The other
item from that spec, reliable fatal-crash capture, shipped via Sentry in v1.1.0.0.

## Performance read models and regional rollout (1.13)

The production Firestore database is in `australia-southeast1`. New clients default to
that callable region; `EXPO_PUBLIC_FUNCTIONS_REGION` can select the legacy region during
a staged rollout. Callables are intentionally exported in both Sydney and Iowa until
older installed clients have migrated. New rebuild and notification workers run in Sydney.
Do not remove the Iowa callable exports as part of this release.

Deploy indexes and rules first and wait for the new composite indexes to finish building,
then deploy the backend, and finally deploy the web/native clients. The existing extraction
and the new optional analysis callable use the `OPENROUTER_API_KEY` secret. No API key
belongs in the app bundle. Validate both callable regions before publishing clients.

A confirmed match and its rebuild request commit atomically. `readModelQueue/office`
tracks requested/completed generations; a leased worker combines work and publishes only
changed documents. Every publication batch checks the lease, and a minute-level recovery
job resumes pending work after a crash. Finalization and finals seeding reject pending or
changed generations. An explicit admin maintenance rebuild can replay finalized ratings;
automatic summary backfills preserve frozen ratings.

`seasonSummaries` contains awards, analytical boards and counts. `playerStats.summary`
contains complete achievements, team records, season counts and logging hints. Existing
leagues generate missing summaries on demand through an authenticated callable. A missing
summary never becomes a partial-history statistic. A server-maintained `sortDate` keeps legacy undated games in cursor pagination without inventing a displayed date. The application listens for completed
generations and invalidates shared caches; a short banner explains the update interval.

Notifications are persisted in `notificationOutbox` before a mutation returns, then sent
with bounded attempts and an HTTP deadline. Delivery is at least once: a process failure
after Expo accepts a request but before acknowledgement can deliver a duplicate. Completed
notification and rebuild event records expire after seven days. Failed notification rows
remain available within that retention window for diagnosis.

The auto-confirm scheduler migrates legacy pending matches in bounded pages, retaining their
original age, then uses indexed due times. Photo cleanup and notification retries also have
per-run limits; backlog is processed by later runs. Monitor backlog age as well as errors.

Use `read_models_ready`, `season_models_rebuilt`, and `league_models_rebuilt` logs for
generation latency and write counts. Client `performance_sample` events sample both fast
and slow screen loads, reads, and cache outcomes at 10 percent when remote logging is enabled.
Compare p50/p95 by platform and app version, separating warm navigation from cold startup.

Run `npm run check` before publishing. Rules tests also exercise the real Firestore emulator
for concurrent workers, stale leases, partial publication, out-of-order results, and no-op
writes. Physical-device scrolling and real-network p95 measurements remain release QA tasks;
local CPU/bundle measurements are not production latency measurements.
