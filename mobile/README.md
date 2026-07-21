# OfficeFC — mobile app (Expo)

Native app (Expo / React Native + Expo Router + TypeScript) for OfficeFC, backed by
Firebase (Auth + Firestore + Storage) and Cloud Functions. See `../docs/implementation-plan.md`
for the full architecture and build sequence.

> **Status:** Product functionality through season administration and push notifications is
> implemented. Production deployment, real-device validation, and store submission remain.

## Run

```bash
npm install

# Web (fastest to preview; also how CI screenshots it)
npm run web                 # dev server
npm run export:web          # static build → dist/

# Native
npm run ios                 # iOS simulator (needs Xcode)
npm run android             # Android emulator
npm start                   # Expo Go / dev client
```

Type-check: `npm run typecheck`.

For camera, AI extraction, and push testing on physical phones, follow
[`../docs/real-device-testing.md`](../docs/real-device-testing.md).

## Environment

Copy `.env.example` → `.env` and fill the public `EXPO_PUBLIC_FIREBASE_*` values from your
Firebase web app config (these are **not** secret — access is governed by security rules).
Set `EXPO_PUBLIC_USE_EMULATORS=1` to point Auth/Firestore/Storage/Functions at the local
**Firebase Emulator Suite** (run `firebase emulators:start` from the repo root; needs
`firebase-tools` installed).

`EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_ENV` control Sentry crash reporting (also a
public identifier). Leave the DSN empty to keep Sentry off; it is disabled in dev builds
regardless. Native builds take these from `eas.json`; see
[`../docs/firebase-setup.md`](../docs/firebase-setup.md) for the full observability setup.

## Layout

```
app/                 ← Expo Router routes
  _layout.tsx        ← root layout: fonts + auth state + notification routing
  (auth)/            ← sign-in, sign-up, forgot-password
  (onboarding)/      ← join, profile-setup, verify-email
  (app)/             ← authenticated app group
    _layout.tsx      ← app layout + push token registration
    index.tsx        ← home dashboard
    leaderboard.tsx  ← season standings
    seasons.tsx      ← season history / hall of fame
    player/[id].tsx  ← player profile + ELO chart
    match/[id].tsx   ← match detail
    log-match.tsx    ← manual + AI snap flow
    confirmations.tsx ← pending confirmations
    head-to-head.tsx ← head-to-head records
    admin.tsx         ← admin panel
    profile.tsx       ← profile editing
    archive/[id].tsx  ← season archive
src/
  theme/             ← design tokens + font loader
  components/        ← UI primitives (Txt, Avatar, StatCard, PlayerRow, LineChart,
                       Button, Icon, Card, chips, SnapFlow, etc.)
  lib/               ← auth, league data access, notifications, upload, profiles,
                       membership, constants, formatting, color math, logging
                       (logger/ → Cloud Logging, sentry.ts → crash reporting)
  types.ts           ← shared domain types
assets/              ← app icon / splash / favicon
```
