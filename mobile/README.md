# OfficeFC — mobile app (Expo)

Native app (Expo / React Native + Expo Router + TypeScript) for OfficeFC, backed by
Firebase (Auth + Firestore + Storage) and Cloud Functions. See `../implementationplan.md`
for the full architecture and build sequence.

> **Status: M0 (scaffold).** The design system is ported from the prototype and the app
> boots; real screens/auth/data land in M1–M3. `app/index.tsx` is a temporary showcase
> of the UI primitives, not a final screen.

## Run

```bash
npm install

# Web (fastest to preview; also how CI screenshots it)
npm run web                 # dev server
npm run export:web          # static build → dist/ ; serve with: node serve-web.js

# Native
npm run ios                 # iOS simulator (needs Xcode)
npm run android             # Android emulator
npm start                   # Expo Go / dev client
```

Type-check: `npm run typecheck`.

## Environment

Copy `.env.example` → `.env` and fill the public `EXPO_PUBLIC_FIREBASE_*` values from your
Firebase web app config (these are **not** secret — access is governed by security rules).
Set `EXPO_PUBLIC_USE_EMULATORS=1` to point Auth/Firestore/Storage at the local
**Firebase Emulator Suite** (run `firebase emulators:start` from the repo root; needs
`firebase-tools` installed).

## Layout

```
app/                 ← Expo Router routes
  _layout.tsx        ← root layout: fonts + dark theme
  index.tsx          ← M0 design-system showcase (temporary)
src/
  theme/             ← design tokens (1:1 from the prototype) + font loader
  components/        ← UI primitives ported to RN (Txt, Avatar, StatCard, PlayerRow,
                       LineChart, Button, Icon, chips, …)
  lib/               ← color math, formatting, Firebase client init
  data/              ← in-memory mock for the M0 showcase only
  types.ts           ← shared domain types
assets/              ← app icon / splash / favicon
serve-web.js         ← static server for the exported web build (SPA fallback)
```
