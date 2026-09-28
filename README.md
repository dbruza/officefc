# OfficeFC

[![CI](https://github.com/dbruza/officefc/actions/workflows/ci.yml/badge.svg)](https://github.com/dbruza/officefc/actions/workflows/ci.yml)

OfficeFC turns an office EA Sports FC league into a proper competition. Players log
matches, opponents confirm results, and the app maintains ELO ratings, standings,
head-to-head records, season history, and photo-backed match evidence.

The production app is built with Expo and React Native for web, iOS, and Android. Firebase
provides authentication, league data, private photo storage, trusted Cloud Functions, and
scheduled jobs.

<p align="center">
  <img src="prototype/officefc/screens/01-home.png" width="320" alt="Original OfficeFC home screen design prototype">
</p>

<p align="center"><em>Original home-screen design prototype used to shape the production app.</em></p>

## Highlights

- Invite-only leagues with email verification and role-based administration
- Opponent-confirmed match logging with manual and AI-assisted entry
- Stats-aware ELO ratings, form, streaks, rankings, and player profiles
- Head-to-head records, match detail, season archives, and player-of-the-month awards
- Private match-photo storage with temporary signed access
- Admin tools for seasons, teams, invites, disputes, and catalogue synchronization
- Push reminders, weekly snapshots, and abandoned-draft cleanup
- Sentry crash and error reporting across the app and Cloud Functions
- Responsive Expo app targeting web, iOS, and Android

## Technology

| Area | Stack |
| --- | --- |
| App | Expo 56, React Native, Expo Router, TypeScript |
| Backend | Firebase Auth, Firestore, Storage, Cloud Functions |
| AI assist | Vision-model stats extraction via OpenRouter, with human review |
| Observability | Sentry (app and functions), Google Cloud Logging |
| Quality | Node test runner, Firebase Rules Unit Testing, ESLint, Prettier |
| Delivery | Firebase Hosting, EAS configuration, GitHub Actions |

## Architecture

```text
Expo app (web / iOS / Android)
  |
  +-- Firebase Auth -------- accounts and email verification
  +-- Firestore ------------ leagues, matches, ratings, seasons, read models
  +-- Cloud Storage -------- private match evidence
  +-- Cloud Functions ------ trusted writes, ELO, admin actions, AI extraction
  +-- Scheduled Functions -- reminders, snapshots, stale-draft cleanup
```

Clients can propose matches, but trusted outcomes are computed on the backend. A match
affects ELO only after opponent confirmation or an audited admin resolution. AI extraction
only pre-fills the form; a player reviews the values before submission.

## Rating system

Ratings are a seasonal ELO (everyone starts at 1500 each season) computed deterministically
from confirmed matches in `functions/src/elo.ts`:

- **Stats-aware result.** A match result is a performance blend, not just the scoreline:
  goal margin (60%), shots on target (25%), and possession (15%). A side can win on the
  scoreboard yet earn little or lose rating if it was dominated on the underlying stats. Each
  match stores an `eloExplain` breakdown, surfaced in the app's "Why the rating moved" panel.
- **Team handicap.** When both teams' overalls are known, each FIFA overall point shifts the
  expected score by 12 ELO, so beating a stronger team is worth more.
- **Placement.** A player holds a ranked place only after `MIN_RANKED_GAMES` (3) games; before
  that they are provisional (no rank, can't take the title) and use a higher K-factor (40 vs
  32) for their first 10 games so new ratings settle faster.
- **Tie-breaks.** Equal ELO is broken by goal difference, then wins, then fewer games played,
  then a stable id.

## Current Status

The product implementation through season administration and notifications is complete.
The remaining release work is production deployment, real-device validation, AI evaluation
with a representative image set, and app-store submission.

See [the implementation overview](docs/implementation-plan.md) and
[web launch runbook](docs/web-mvp-launch.md) for the current release checklist.

## Run Locally

Requirements:

- Node.js 20
- npm
- Java 21 for the Firebase Emulator Suite

Install each workspace:

```bash
npm ci
npm --prefix mobile ci
npm --prefix functions ci
npm --prefix test/rules ci
```

Configure the app:

```bash
cp mobile/.env.example mobile/.env
```

Add the public Firebase web configuration to `mobile/.env`. Use
`EXPO_PUBLIC_USE_EMULATORS=1` for local development.

Start Firebase in one terminal and the Expo web app in another:

```bash
npx firebase emulators:start
npm --prefix mobile run web
```

Native development is available through `npm --prefix mobile run ios` and
`npm --prefix mobile run android`. Camera, uploads, and push notifications require the
real-device workflow in [docs/real-device-testing.md](docs/real-device-testing.md).

## Quality Checks

```bash
npm run format:check       # formatting
npm run lint               # zero-warning lint
npm run typecheck:mobile   # cache-clean mobile TypeScript check
npm run build:web          # production Expo export and environment validation
npm run test:functions     # Cloud Functions tests
npm test                   # extraction and ELO tests
npm run test:rules         # Firestore and Storage security rules
```

`npm run check` runs the complete local CI sequence.

## Project Layout

```text
mobile/                 production Expo application
functions/              Firebase Cloud Functions and backend tests
test/                   extraction, ELO, and security-rules tests
eval/                   labeled AI extraction evaluation harness
docs/                   setup, testing, architecture, and release runbooks
prototype/officefc/     original visual prototype and design references
firebase.json           Hosting, Functions, and emulator configuration
firestore.rules         Firestore authorization boundary
storage.rules           private match-photo authorization boundary
```

The standalone HTML under `prototype/officefc/` is retained as design history. It is not
the production architecture or deployment target.

## Copyright

Copyright (c) 2026 David Bruza. All rights reserved. This repository is source-available
for portfolio review and does not grant permission to copy, modify, or redistribute the
software.
