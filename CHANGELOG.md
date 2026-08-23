# Changelog

All notable changes to OfficeFC are documented here.
Versions follow a 4-digit MAJOR.MINOR.PATCH.MICRO scheme; dates are YYYY-MM-DD.

## [1.7.0.0] - 2026-08-24

### Added

- "What's new" in the app: Settings → About → Version now opens a changelog screen listing
  every release, newest first, with the current release highlighted. The content is
  generated from the repo's CHANGELOG.md at release time, so it can't drift from what
  actually shipped.

## [1.6.0.0] - 2026-08-24

### Fixed

- Finals results are now safe against races. The whole bracket lives in one Firestore
  document, so two ties confirming at once (or a player's confirmation racing an admin
  resolve) could previously read the same snapshot and the last whole-doc write would
  silently erase the other tie's result, stranding the bracket. Bracket advancement now
  runs inside a transaction — the losing writer re-reads and sees the slot already
  decided instead of overwriting it. Team-dealing reads were also hoisted out of the
  transaction so they don't re-run on contention retries.
- Confirmations into a season whose results are already published are refused, on every
  path: player confirmation, admin resolve, and the auto-confirm scheduler alike.
  finalizeSeason snapshots champion and premier from the standings as they were, and a
  late-landing result used to be able to rewrite those tables with no re-publication.
- When a finals result loses a race for its slot (an admin walkover or a concurrent
  resolve got there first), callers no longer claim it succeeded: the player gets an
  honest push ("recorded, but that tie had already been decided"), admins get a warning
  log or a failed-precondition error from awardWalkover, rather than a false "locked
  into the bracket".
- A failed profile read after sign-in (offline, transient Firestore error) is no longer
  mistaken for a brand-new user. The app now holds routing and offers a retry screen
  instead of dumping established players back into onboarding.
- Six screens showed their empty state while a load was failing, telling players "no
  confirmed games yet" over what was really a network error. Leaderboard, seasons,
  games, head-to-head, finals, and archive now show an explicit failure card with a
  retry button instead.

### Changed

- Pull-to-refresh on every data screen — home, leaderboard, seasons, games, match
  history, profiles, head-to-head, finals. Previously the only refresh was reopening
  the app, which also made expired match-photo URLs unfixable without a restart.
- Player-profile head-to-head loading no longer downloads the entire h2h collection and
  filters client-side; two indexed queries replace the scan, so cost stops growing with
  the square of league membership.
- CI runs on pushes to development, local Node is pinned to 22 to match CI (the mobile
  test runner needs Node 21+ globbing), and mobile test discovery uses a recursive glob
  so new tests can't be forgotten from the list.

## [1.5.0.1] - 2026-08-22

### Fixed

- The web app went blank for returning visitors after a release. Two Firebase Hosting
  rules combined into a self-perpetuating failure: the no-store header was scoped to
  `/index.html`, but header globs match the requested path rather than the rewrite
  destination, so `/` and every deep route — the only paths anyone actually requests —
  were served with no cache directive at all and could be held by the browser. A stale
  `index.html` then asked for the previous release's bundle hash, which the catch-all
  `**` rewrite answered with `index.html` itself at HTTP 200 and `Content-Type:
  text/html`. The browser parsed HTML as JavaScript (`Unexpected token '<'`), rendered
  nothing, and — because `/_expo/static/**` is served `max-age=31536000, immutable` —
  cached that broken response for a year, so reloading never recovered.

  The no-store rule now covers `**` (the immutable asset rules still override it for
  `/_expo/static/**` and `/assets/**`), so every HTML response revalidates. The SPA
  rewrite now excludes `/_expo/**` and `/assets/**`, so a missing hashed asset returns a
  clean 404 instead of HTML masquerading as JavaScript. Both behaviours are verified
  against the Firebase Hosting emulator, which uses the production path matcher, and the
  invariants are written down in the launch runbook.

## [1.5.0.0] - 2026-08-19

### Added

- The match detail screen now explains ELO changes in plain English. Beneath the score,
  "Why the rating moved" gives each player a short, match-specific narration — who was
  expected to win and why (rating gap, team-strength handicap, the reigning premier's
  handicap), how the scoreline scored on performance, what the recorded chances said,
  and what the outcome was worth — followed by the existing numbers table.

  This answers the most common rating complaint directly: a narrow win that lands almost
  exactly on the expected result (e.g. a strong favourite edging a one-goal win, or an
  evenly-rated pairing splitting the chances) rounds to 0, and until now the app showed
  only a bare "+0". The same panel also calls out the other counter-intuitive outcomes —
  a win that costs points when the chances went the other way, and a loss that earns
  them. Matches confirmed before the explanation data existed fall back to the numbers
  table alone.
## [1.4.1.0] - 2026-08-21

### Added

- The FIFA 23 team catalogue is now complete to the launch snapshot. The scraped
  dump that generated it had skipped roughly 99 real club teams — the scrape's
  middle pages re-captured overlapping CONMEBOL-heavy rows, so most of the
  affected squads sat in the 52–76 OVR bands and never made it into the picker.
  Recovered clubs include Brentford, Atalanta, Torino, Lecce, Eintracht Frankfurt,
  VfL Bochum, the four Championship 2022–23 newcomers, the 2022–23 promoted
  Segunda sides (Leganés, Eibar, Cartagena), the full Austrian, Swiss, Danish,
  Norwegian and Swedish top flights, Austin FC and Seattle Sounders, Al Hilal,
  Mamelodi Sundowns, Orlando Pirates, the Argentine and Chinese/Indian/Korean
  clubs the sweep had missed, and the CONMEBOL clubs parked in a single repeated
  page.
- The duplicate "Roma" entry is gone — FIFA 23 ships the licensed Roma FC
  (80/82/77/81), and the separate "Roma" row (80/82/79/82) was a listing artifact
  of the same club. The catalogue now carries Roma FC only.

All recovered ratings are FIFA 23 launch data, matching the snapshot every
existing entry was drawn from.

## [1.4.0.0] - 2026-08-13

### Added

- An undisputed match now auto-confirms after 1 hour. The named opponent keeps the full
  hour to confirm or dispute, and is reminded at 30 minutes so a result never locks in
  without warning; if they still don't respond, a scheduled job confirms the match on their
  behalf, marks it `confirmedBy: "auto"` with an `autoConfirmedAt` timestamp, and notifies
  both players. The check runs every 10 minutes, so a stale result lands in the table within
  ~10 minutes of the window closing.

  Finals are deliberately excluded and always wait for a human — the opponent confirming, or
  an admin resolving it. A knockout result is where consent matters most, and advancing the
  bracket is a side effect that cannot be replayed once the match stops being pending.

  Scope is otherwise narrow: only the active, unfinalized season is swept, matches left
  pending for more than 72 hours are treated as abandoned and left for an admin, and a run
  confirms a bounded batch and rebuilds the tables once for the whole batch. On first deploy
  the sweep arms itself and waits a full window, so results submitted before the feature
  existed get a real chance to be disputed instead of being locked in en masse. If a rebuild
  is interrupted, the affected season is recorded and repaired on the next run; a season that
  has since been finalized is dropped rather than rebuilt, so published standings are never
  rewritten.

### Changed

- The pending-match reminder now fires 30 minutes after submission instead of 48 hours,
  so it lands inside the new dispute window rather than after the result has already
  confirmed.

### Fixed

- The ELO change preview while logging a match now matches the ELO the server actually
  commits. Previously the preview approximated with a plain win/draw/loss score, so it
  diverged from the real, goal-margin-weighted result (e.g. a 1–0 and a 5–0 previewed
  identically but committed differently). The preview now runs the server's exact formula —
  goal margin blended with shots-on-target and possession when known (Snap flow), team
  overalls, and the reigning Premier handicap — and a parity test guards the two
  implementations from drifting apart.

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


