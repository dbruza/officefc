# OfficeFC — mobile app (Expo)

Native app (Expo / React Native + Expo Router + TypeScript) for OfficeFC, backed by
Firebase (Auth + Firestore + Storage) and Cloud Functions. See `../implementationplan.md`
for the full architecture and build sequence.

> **Status: M5 (all phases complete).** Auth, match lifecycle, ELO, standings, AI-assisted
> logging, season admin, and push notifications are implemented. Awaiting M6 production release
> (Firebase deploy + EAS Build + store submission).

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

## Environment

Copy `.env.example` → `.env` and fill the public `EXPO_PUBLIC_FIREBASE_*` values from your
Firebase web app config (these are **not** secret — access is governed by security rules).
Set `EXPO_PUBLIC_USE_EMULATORS=1` to point Auth/Firestore/Storage/Functions at the local
**Firebase Emulator Suite** (run `firebase emulators:start` from the repo root; needs
`firebase-tools` installed).

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
    inbox.tsx        ← pending confirmations
    head-to-head.tsx ← head-to-head records
    admin.tsx         ← admin panel
    profile/edit.tsx  ← profile editing
    archive/[id].tsx  ← season archive
src/
  theme/             ← design tokens + font loader
  components/        ← UI primitives (Txt, Avatar, StatCard, PlayerRow, LineChart,
                       Button, Icon, Card, chips, SnapFlow, etc.)
  lib/               ← auth, league data access, notifications, upload, profiles,
                       membership, constants, formatting, color math
  types.ts           ← shared domain types
assets/              ← app icon / splash / favicon
```
