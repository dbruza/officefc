# Firebase backend reference

OfficeFC uses Firebase Authentication, Firestore, Storage, Cloud Functions, Cloud
Scheduler, Hosting, and the local Emulator Suite. This page explains how those pieces fit
together and how to observe them. To create a project and deploy your own league, follow
the [self-hosting guide](self-hosting.md) instead.

## Services

| Service              | Used for                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| Authentication       | Email/password accounts and email verification                          |
| Firestore            | The league, members, seasons, matches, ratings, and derived read models |
| Storage              | Private match photos for AI photo logging                               |
| Cloud Functions (v2) | Trusted writes, ELO, admin actions, notifications, AI extraction        |
| Cloud Scheduler      | Reminders, auto-confirm, weekly snapshots, cleanup, retries, recovery   |
| Hosting              | The static Expo web export, with single-page-app rewrites               |

Firebase web configuration is public client metadata, not a secret. Authorization is
enforced by `firestore.rules`, `storage.rules`, and the Cloud Functions. The league id is
fixed to `office` (`LEAGUE_ID` in `functions/src/config.ts` and
`mobile/src/lib/constants.ts`); one deployment runs one league.

## Requirements

- Node.js 24
- Java 21 for the Emulator Suite
- For deployments, a Firebase project on the Blaze plan (Functions and Storage need it)

The Firebase CLI is pinned in the root development dependencies, so use it through `npx`
or the repository scripts.

## Project selection and configuration

Nothing deployment-specific is committed:

- `npx firebase use --add` selects the project (written to the gitignored `.firebaserc`).
  The deploy scripts target the active project.
- Cloud Functions settings (`FUNCTIONS_REGION`, `ADMIN_EMAILS`, `AI_FEATURES`,
  `SENTRY_DSN`) are Firebase parameters in `functions/.env.<projectId>`, defined in
  `functions/src/config.ts`. `firebase deploy` prompts for missing values and saves them.
- `OPENROUTER_API_KEY` lives in Secret Manager and is only bound when `AI_FEATURES=true`.
- App settings are `EXPO_PUBLIC_*` variables in `mobile/.env` (or EAS environment
  variables for native builds).

The [configuration reference](self-hosting.md#configuration-reference) lists every value.

### Storage rules and Firestore

`storage.rules` checks league membership with `firestore.get()`. In deployed environments,
the Firebase Storage service account
`service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com` must have the
**Firebase Rules Firestore Service Agent**
(`roles/firebaserules.firestoreServiceAgent`) role. Without it, valid member uploads fail
with `storage/unauthorized` even though the same rules pass in the local emulators.

The Firebase console or CLI normally offers to enable this permission when cross-service
Storage rules are first deployed. You can verify the grant in Google Cloud IAM by enabling
**Include Google-provided role grants**.

### Signed photo URLs

Match photos are never read directly from Storage. `getMatchPhotoUrl` mints short-lived
signed URLs, which needs the functions' runtime service account
(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) to hold **Service Account Token
Creator** on itself. Without it the function fails with
`Permission 'iam.serviceAccounts.signBlob' denied`. The Functions emulator can't sign URLs
at all, so photo viewing only works against a deployed backend.

## Local development

Local development uses the demo project id `demo-officefc`, so it never touches a real
project. `mobile/.env.example` is already set up for it.

```bash
cp mobile/.env.example mobile/.env
npm --prefix functions run build
npx firebase emulators:start --project demo-officefc
```

In another terminal:

```bash
npm --prefix mobile run web
```

The Emulator UI is available at <http://localhost:4000>. Service ports are defined in
`firebase.json`. The Functions emulator reads its parameters from the committed
`functions/.env.demo-officefc` (which makes `admin@office.test` an admin), overridden by a
gitignored `functions/.env.local`.

## Verify security rules

Install the rules-test workspace and run the emulator-backed suite:

```bash
npm --prefix test/rules ci
npm run test:rules
```

These tests cover league membership boundaries, trusted match fields, onboarding reads,
team validation, and private match-photo access. The integration tests in
`functions/integration/` run against the same emulator. `npm run test:rules` uses
Firestore port 8080, so stop a running `emulators:start` first.

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

Sentry is optional and sits alongside Cloud Logging:

- **App** (`mobile/src/lib/sentry.ts`): captures native and fatal JS crashes, render
  errors, and error-level log events; every log entry also becomes a breadcrumb. Configure
  with `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENV` (`mobile/.env` for local dev
  and the web deploy; EAS environment variables for native builds, where `eas.json` sets
  the environment name per profile). Disabled in dev builds.
- **Functions** (`functions/src/sentry.ts`): callables report unexpected server faults
  with function name, uid, and duration; scheduled jobs and Firestore triggers report with
  the function name (expected `HttpsError` rejections are never sent, and the one-off
  `backfillSeasonCodes` migration endpoint is not instrumented). Configure with the
  `SENTRY_DSN` parameter in `functions/.env.<projectId>`. Disabled in the emulator.
- **Off by default:** DSNs are public identifiers, not secrets, but none ship with the
  repository. With no DSN, captures do nothing and a `sentry_disabled` warning is logged so
  the state stays visible.
- **Source maps:** `mobile/metro.config.js` wraps the Expo Metro config so bundles carry
  debug IDs. Automatic source-map upload is off in every EAS profile
  (`SENTRY_DISABLE_AUTO_UPLOAD=true` in `mobile/eas.json`); symbolicated native releases
  need `SENTRY_ORG`, `SENTRY_PROJECT`, a `SENTRY_AUTH_TOKEN`, **and** that flag removed or
  set to `false`.

Future hardening (App Check for the `ingestLog` sink) is described in
[the logging design spec](design/specs/2026-06-15-firebase-logging-observability-design.md).

## Read models and background processing

Leaderboards, profiles, and season summaries are served from read models that the backend
rebuilds after each change, so screens read a handful of documents instead of every match.

A confirmed match and its rebuild request commit atomically. `readModelQueue/office`
tracks requested and completed generations; a leased worker combines work and publishes
only changed documents. Every publication batch checks the lease, and a minute-level
recovery job resumes pending work after a crash. Finalization and finals seeding reject
pending or changed generations. An explicit admin maintenance rebuild can replay finalized
ratings; automatic summary backfills preserve frozen ratings.

`seasonSummaries` contains awards, analytical boards and counts. `playerStats.summary`
contains complete achievements, team records, season counts and logging hints. Existing
leagues generate missing summaries on demand through an authenticated callable. A missing
summary never becomes a partial-history statistic. A server-maintained `sortDate` keeps
legacy undated games in cursor pagination without inventing a displayed date. The app
listens for completed generations and invalidates shared caches; a short banner explains
the update interval.

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
and slow screen loads, reads, and cache outcomes at 10 percent when remote logging is
enabled. Compare p50/p95 by platform and app version, separating warm navigation from cold
startup.

### Deploy order

When a release adds indexes, deploy the backend (`npm run deploy:backend` deploys rules,
indexes, and functions together), wait for the new composite indexes to finish building
(Firestore → Indexes), and only then deploy the web and native clients.

The AI extraction and match-analysis callables use the `OPENROUTER_API_KEY` secret and are
only deployed when `AI_FEATURES=true`. No API key belongs in the app bundle.

Run `npm run check` before publishing. Rules tests also exercise the real Firestore emulator
for concurrent workers, stale leases, partial publication, out-of-order results, and no-op
writes. Physical-device scrolling and real-network p95 measurements remain release QA tasks;
local CPU/bundle measurements are not production latency measurements.
