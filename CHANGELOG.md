# Changelog

All notable changes to OfficeFC are documented here.
Versions follow a 4-digit MAJOR.MINOR.PATCH.MICRO scheme; dates are YYYY-MM-DD.

## [1.13.0.0] - 2026-10-02

### Changed

- Match confirmation persists a recoverable rebuild request and returns promptly. A serialized worker batches updates, avoids unchanged writes, and refreshes open screens when standings are ready.
- Profiles, season archives, analytics and logging use stored summaries. Game history loads in pages with virtualized rows; shared caches reuse league data and invalidate after writes.
- New clients call Sydney functions beside the Sydney database; existing Iowa callable endpoints remain available during migration.
- Web routes load separately, authentication starts alongside fonts, and optional photo/voting content no longer delays match results.
- Photo uploads use the extraction resolution with one client encode. Push delivery runs through a durable outbox, and model requests have a shared deadline.
- Full checks compile Functions once. Performance samples, write counts and queue recovery tests guard the new paths.

### Added

- On-demand match analysis with a bounded model fallback, one generation per match at a time, and cached results tied to the rating revision.

## [1.12.1.0] - 2026-10-01

### Changed

- Cloud Functions now run on Node.js 24 (`nodejs24`, supported until October 2028). The
  Node.js 20 runtime is decommissioned on 30 October 2026, after which the backend could no
  longer be deployed. The Functions SDKs move to firebase-functions 7.4 and firebase-admin
  14.5. The code already used only the v2 trigger APIs and modular Admin imports, so no
  function behaviour changes. CI and `.nvmrc` move to Node 24 as well, so tests run on the
  same Node major that production executes.

## [1.12.0.0] - 2026-10-01

### Added

- Photo logging now catches a misread score. On an EA SPORTS FC full-time screen, a side's
  goals should equal its shots on target minus the other keeper's saves (give or take one,
  for an own goal or a goal-line block). When the score disagrees, the check screen spells
  out the sums, for example "You had 9 on target and Sam's keeper made 6 saves — that's 3,
  but the score says 8", and Submit waits until you either take the suggested score or
  confirm yours is right. The check re-runs as you edit, and the server records the outcome
  with the match.
- Shots on target are filled in again for FC 27 photos. The FC 24+ summary screen no longer
  prints a shots-on-target row, so the AI now reads the Shot Accuracy panel and the app
  works the count out from shots × accuracy (exact for any real match).
- The AI also reads Saves and Ball Recovery Time. Both can be checked and edited before
  submitting, are stored with the match, and show on the match page.

### Changed

- The reading instructions now describe the FC 24+ layout (home values and side panels on
  the left, away on the right) and warn that photos of a TV taken at an angle can shift a
  column up or down against its row labels.
- The extraction eval scores Saves, Ball Recovery Time and Shot Accuracy for labels that
  include them.

## [1.11.1.0] - 2026-10-01

### Fixed

- Drawing the mid-season cup works. The bracket was saved as a list of rounds that were
  themselves lists, which Firestore refuses to store ("Nested arrays are not allowed"), so
  every draw failed, and the error was misreported as "This season already has a cup".
  Each round is now saved as `{ ties: [...] }`, and a genuine save failure now says the cup
  couldn't be started instead of claiming one exists. No cup could ever have been saved in
  the old shape, so there is nothing to migrate.

## [1.11.0.0] - 2026-10-01

### Added

- The web app now uses the whole browser window. From tablet width up, a side rail replaces
  the bottom tab bar and stays put on every screen, with Log match (shortcut N), search, an
  Inbox badge for results awaiting you, and your profile. On desktop the screens split into
  columns: Home puts your season, inbox and "Play next" beside your place in the table and
  the activity feed; the table becomes a sortable data table with a podium; profiles get a
  wide ELO chart with a hover read-out.
- ⌘K / Ctrl+K opens a command palette to jump to any player or screen, or start a match
  against someone.
- Home now answers "where am I and who's next": a "results need your OK" banner, "waiting on"
  rows for results you logged, a mini table of the places around you with the ELO gap, and a
  "Play next" pick (an open cup tie, then the nearest-rated opponent you haven't played this
  season). Tapping a suggestion opens Log match with that opponent already chosen.
- Logging a match is quicker: the app remembers how you last logged, opponents are sorted by
  who you play most with a search box, your team defaults to the one you used last, score
  and review are one step, Enter/Esc and arrow keys work on desktop, and the finish screen
  offers Rematch. Photo logging accepts drag-and-drop and pasting a screenshot on desktop,
  shows the photo next to the values you're checking, and walks through upload, reading and
  team matching step by step.
- The opponent can confirm or dispute straight from the match page a "match pending" push
  opens. Confirmation cards show when the game was played and what confirming does to your
  ELO; disputing asks for an optional reason.
- Finals and the cup draw as a real bracket on wide screens, with your route and the
  champion's route highlighted, and a champion celebration the first time you see the result.
- Season recaps play as a story you tap or arrow through, ending on a share card that can be
  downloaded or shared from the browser too.
- Admin opens on an overview: season phase with the next step, the results queue, the join
  code (copy code or invite link), and the cup. Invite links prefill the join code, even
  through sign-up.
- Every screen loads with placeholders shaped like its content, fades in, and counts up the
  numbers that matter. Buttons, rows and cards respond to hover, press and keyboard focus.
  Motion is skipped when the device asks for reduced motion.

### Changed

- Dialogs on the web are now in-app and styled (Esc cancels, Enter confirms) instead of the
  browser's pop-ups, and success messages are short toasts instead of alerts.
- Activating, starting finals and finalizing a season all ask first and can't be
  double-clicked. Finalizing the active season offers to activate the next one in the same
  step, and warns when there's no next season (otherwise a placeholder season is recreated).
  A season can now be finalized before its end date, after a warning that it ends early.
- Sign-in and sign-up are a split screen on desktop with a step indicator through
  onboarding. Enter moves between fields and submits, and password managers recognise the
  forms. The verify-email screen moves on by itself once you've clicked the link.
- ELO changes read "+12" / "−7"; the ▲/▼ arrows now only mean rank movement.
- Tertiary text is brighter for readability, and browser tabs show the screen name plus a
  count of results awaiting you.

### Fixed

- On the web, several confirmations and error messages never appeared: starting the cup,
  forcing a cup tie, awarding a finals walkover and failed prediction saves.
- A failed submit or fixture deal no longer leaves Log match permanently stuck; photo-logging
  submit errors are now shown.
- The web app has a refresh button and refreshes when you come back to the tab, since
  pull-to-refresh doesn't exist in a browser.
- Back buttons work after refreshing the page or opening a shared link, and a signed-out
  visitor following a shared link lands on it after signing in.
- Head-to-head showed clean sheets and the ELO swing against the wrong player whenever
  player A wasn't first alphabetically, and briefly kept the previous pair's record after
  switching players.
- Tapping the Admin chip on Home also opened your profile; the table's champion crown
  went to the latest champion on past seasons; Home showed made-up numbers when it couldn't
  load; and the ELO chart stayed 326px wide on larger screens.

## [1.10.2.0] - 2026-09-28

### Fixed

- Photo logging now pre-picks the right team more often, and never a wrong one. It used to
  take the top search result for the team name printed on the stats screen, so "Roma" picked
  Romania, "Milan" picked Inter and "Barcelona" picked Barcelona de Guayaquil, each skewing
  the ELO team-strength handicap if nobody noticed. Matching now ignores club affixes (FC,
  AC, SSC, "de" and so on), knows common short names and scoreboard codes (Man City, Spurs,
  PSG, Inter, BVB, MCI), and leaves the pick to you when a name could mean more than one team
  ("Manchester", "Paris").
- Updating the team catalogue now carries admin renames and hidden teams over to the same
  club in the new catalogue. Each game edition gives every team a new id, so these overrides
  were silently dropped, even though the confirm dialog promised to keep them. The admin
  button is now "Update team catalogue" and reports how many overrides it carried.
- Retired teams keep the catalogue version that first retired them, instead of being
  re-stamped with the latest version on every sync.

### Changed

- Stats-screen reading now goes through OpenRouter to Meta's Muse Spark 1.3 (contributor
  tier) instead of calling Anthropic's Claude Sonnet 4.5 directly. The Anthropic account had
  run out of credit, so every photo had failed since 21 September. The model is one constant
  (`DEFAULT_MODEL`), so any other OpenRouter vision model is a one-line change. The model now
  answers with JSON constrained to the stats schema rather than through a forced tool call,
  which Meta's endpoint doesn't accept. Muse Spark always reasons, so requests ask for low
  effort and leave 4096 tokens for reasoning and the answer. The backend reads a new
  `OPENROUTER_API_KEY` secret, and the photo screen's privacy note now names OpenRouter and
  Muse Spark. An empty or malformed answer is reported with the model's finish reason, and
  running out of OpenRouter credit fails at once instead of retrying.

## [1.10.0.0] - 2026-09-25

### Changed

- The team picker now carries EA SPORTS FC 27 teams and ratings, replacing the FIFA 23
  catalogue: 684 clubs across 54 leagues plus 51 national teams (OVR 54–86), taken from
  the FC 27 launch roster (17 Sep 2026). Promoted and relegated clubs sit in their
  2026–27 divisions, and competitions keep the "Country League" naming so searching by
  country still works (e.g. "England Premier League", "Spain LaLiga EA Sports").
- Matches already played keep the FIFA 23 ratings they were played with. FC 27 teams,
  national sides included, get new team ids, and the FIFA 23 entries are retired from the
  picker rather than re-rated, so a season recalc can't shift the team-strength handicap
  on old results. The national teams previously kept fixed ids across catalogue updates;
  they now version with the game like clubs do.
- Auto-dealt fixtures and open finals ties that were dealt FIFA 23 teams before the switch
  can still be recorded with those teams. Only matches where players choose their own teams
  now require a team from the current picker; fixture and finals results already have to
  use exactly the teams the engine dealt, so retiring a catalogue no longer strands a
  matchup that's in progress.

## [1.9.0.1] - 2026-09-22

### Fixed

- The Final score step in "Log a match" (and the same stepper in SnapFlow's verify
  step) broke out of the screen on narrow viewports — Android phones and narrow web
  windows showed the − / + buttons half-clipped at the screen edges. The stepper
  buttons kept their fixed size, squeezing the growing "0" glyph out of the row, and
  on web the input's width contribution came from `min-width` alone, so React Native
  Web measured it as unconstrained text and let the row overflow its parent. The
  buttons are now `flex-shrink: 0`, the column carries `min-width: 0`, and the score
  input is `flex: 1` capped at 72px, so the input absorbs any shrinkage and the whole
  row stays inside the visible screen on native and web.

## [1.9.0.0] - 2026-08-25

### Added

- Season stats boards on the Leaderboard's new Stats view, built from the stats already
  captured by AI screenshot extraction: clinical finishers (goals vs xG overperformance),
  shot volume with on-target accuracy, possession averages, and a live streaks board
  (current win streaks and winless runs). Finals matches are excluded everywhere, and
  players without extracted data are called out rather than silently missing.
- Team meta-analytics screen (Games → chart icon): most-picked teams with win rates,
  win rate by team-strength band, and a fixture-engine fairness card comparing
  auto-dealt matchups against manual logs — the league can now see whether the ELO-
  balanced dealing actually flattens team strength.
- Head-to-head rivalry stats: biggest result between the pair, goals per game, clean
  sheets each way, and net ELO swing, plus nemesis/victim cards on player profiles
  (best and worst matchup by win rate, minimum three games) that tap through to a
  prefilled head-to-head.
- Finals prediction game: pick the winner of every finals tie while it's open — backing
  the underdog seed scores double — with a season prediction leaderboard under the
  bracket. Picks are locked per slot once that tie is decided; provably late edits don't
  score.
- Per-match MVP peer voting: after a confirmed match, both participants can vote for the
  man of the match (not yourself) within 48 hours; everyone sees the running tally.
- Mid-season knockout cup: an admin draws a random single-elimination bracket over the
  roster; ties are played as normal logged matches and the bracket advances itself when
  the result confirms. Admin force-advance repairs stuck slots. A cup banner appears on
  home while it runs.
- End-of-season recap: finalization now records golden boot, best defence, most improved,
  longest win streak, biggest rivalry, game of the season and biggest upset onto the
  season's results, rendered on a shareable recap card reachable from past seasons.
- Notification preferences in Settings: mute push by category (results, confirmations,
  disputes, fixtures, finals) with everything delivered by default.

### Changed

- The multi-league groundwork assessment documents what a second league would actually
  take (rules rewrite + membership model), replacing speculative abstraction.

## [1.8.0.0] - 2026-08-24

### Added

- Expected goals (xG) now feeds the ELO calculation. The performance blend is goals 60% /
  xG 25% / possession 15% — xG replaces shots on target, which is still recorded and shown
  but no longer moves ratings. Matches logged before xG existed simply drop that term and
  reweight to goals + possession, so a season recalc won't distort old results.
- The AI stats-photo scan reads xG off the full-time screen like the other key stats,
  pre-fills it in the snap flow (editable), shows it in the review summary, the match
  detail stats table, and the plain-English "why the rating moved" explainer ("0.7–2.1 xG").

### Fixed

- Submitted match stats were only bounds-checked for goals; possession, shots, shots on
  target could be any number at all (e.g. possession 5000) and fed straight into ratings.
  All submitted stats are now range-checked server-side.

### Changed

- The match-detail ELO explainer is one paragraph about the match instead of mirrored
  per-player blocks saying the same thing twice.

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

