# Changelog

All notable changes to OfficeFC are documented here.
Versions follow a 4-digit MAJOR.MINOR.PATCH.MICRO scheme; dates are YYYY-MM-DD.

## [1.3.0.0] - 2026-08-04

### Added

- Creating a season now uses date and time pickers instead of typed ISO strings. Both
  fields open a calendar sheet with a month grid and hour/minute rows, open on the current
  selection, and default to a 90-day season running 09:00 to 21:00. The end can't be set
  before the start, the form shows the season's length as you adjust it, and Create stays
  disabled until the name and dates are valid.

### Fixed

- A dev reload no longer red-boxes with "auth/already-initialized". `initializeAuth` runs
  at module scope on native, so re-evaluating the module against a live Firebase app threw
  an uncaught error that blocked the app until dismissed; the existing instance is now
  reused. Release builds, which evaluate the module once, are unaffected.

## [1.2.0.0] - 2026-08-03

### Added

- A "Teams played" section on every player profile: the team you use most is called out
  as your favourite with its win rate, record, rating swing per game, last-five form, and
  goals for/against, followed by a row per other team you've played. The team with the
  strongest record — measured only once it has a real sample and a rival that cleared the
  same bar — is flagged as your best. Everything is derived from confirmed matches the
  profile already loads; the team catalogue only supplies the crest rating and
  competition, so a missing catalogue entry falls back to the name on the match.

## [1.1.1.0] - 2026-07-22

### Fixed

- Native photo upload for AI-assisted match logging crashed with "Creating blobs from
  'ArrayBuffer' and 'ArrayBufferView' are not supported": Expo SDK 56 replaces the global
  fetch with expo/fetch, whose `Response.blob()` builds a Blob React Native rejects. The
  picked image is now read through React Native's XMLHttpRequest into a true native Blob
  (web keeps fetch), which is also released from native memory after upload.
- App no longer hangs on the startup spinner on physical devices: Firestore's streaming
  transport can stall indefinitely under React Native, so native builds now force long
  polling (web keeps streaming). A stall beacon reports any future auth-bootstrap wedge
  after 10 seconds.

### Added

- Snap-flow failures (photo pick, upload, extraction, submission) are now reported to
  Sentry and Cloud Logging with error codes and draft IDs instead of only being shown
  in the UI; rejected extractions and best-effort cleanup failures log as warnings.
- The mobile Sentry DSN is set in all EAS build profiles, activating crash reporting in
  store builds (previously the empty placeholders also made any `eas build` refuse to
  start).

## [1.1.0.0] - 2026-07-21

### Added

- Sentry crash and error reporting across the whole app. The mobile app now captures
  native and fatal JavaScript crashes (persisted and uploaded on next launch), render
  errors, and error events — each with screen-by-screen breadcrumbs and the signed-in
  player attached, so "the app crashed for someone last night" becomes a readable stack
  trace tied to a user and a screen.
- Server-side fault reporting across the Cloud Functions: callables, scheduled jobs, and
  Firestore triggers (match notifications, fixture consumption, the client log sink) all
  report unexpected failures to Sentry with the function name, calling user, and duration.
  Expected client rejections stay out of the noise.
- Performance tracing on 20% of mobile sessions: app-start timing and per-screen
  navigation spans.
- Source-map plumbing (Metro config + build phases) so crash reports symbolicate to
  readable frames; automatic upload stays off until a Sentry auth token is provisioned
  and the interim `SENTRY_DISABLE_AUTO_UPLOAD` flag is removed from `eas.json`.
- Skill-routing guidance in CLAUDE.md so agent sessions pick the right workflow
  automatically.

### Changed

- Client logs now double-write: every log becomes a Sentry breadcrumb and error-level
  events are filed as grouped Sentry issues, while the existing Cloud Logging pipeline
  (`ingestLog`) continues unchanged.
- Unhandled promise rejections in Cloud Functions keep their fail-fast semantics under
  Sentry (captured, then surfaced) instead of being silently downgraded to warnings.

### Notes

- The integration ships dormant: reporting activates once the Sentry project DSNs are
  filled in (mobile `eas.json` / `.env`, functions `.env`). Until then a
  `sentry_disabled` warning is logged so the dormant state is visible.
