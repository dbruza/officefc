# Changelog

All notable changes to OfficeFC are documented here.
Versions follow a 4-digit MAJOR.MINOR.PATCH.MICRO scheme; dates are YYYY-MM-DD.

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
