# OfficeFC — app (Expo)

The OfficeFC app for web, iOS, and Android (Expo / React Native + Expo Router + TypeScript),
backed by Firebase (Auth, Firestore, Storage) and Cloud Functions. See the
[project README](../README.md) for an overview and the
[self-hosting guide](../docs/self-hosting.md) to deploy it.

## Run

Install from this directory (the root, `functions/`, and `test/rules/` have their own
installs; see [CONTRIBUTING.md](../CONTRIBUTING.md)):

```bash
npm ci

# Web (fastest to preview)
npm run web                 # dev server
npm run export:web          # static build → dist/ (deploys use `npm run build:web` at the root)

# Native
npm run ios                 # iOS simulator (needs Xcode)
npm run android             # Android emulator
npm start                   # dev client
```

Type-check: `npm run typecheck`. Tests: `npm test`.

For camera, AI extraction, and push testing on physical phones, follow
[`../docs/real-device-testing.md`](../docs/real-device-testing.md).

## Environment

Copy `.env.example` → `.env`. As shipped, it points the app at the local **Firebase
Emulator Suite** with the demo project `demo-officefc`, so it works without a Firebase
project. Start the emulators from the repo root:

```bash
npm --prefix functions run build
npx firebase emulators:start --project demo-officefc
```

For a deployed build, replace the six `EXPO_PUBLIC_FIREBASE_*` values with your Firebase
web app config (these are **not** secret; access is governed by security rules) and set
`EXPO_PUBLIC_USE_EMULATORS=0`. The other settings (functions region, AI features, admin
emails, operator name, support email, data location, web URL, logging, and Sentry) are
described in `.env.example` and the
[configuration reference](../docs/self-hosting.md#configuration-reference).

Expo inlines `EXPO_PUBLIC_*` values at build time, so restart the dev server or rebuild
after changing them. Native EAS builds don't read `.env`; they take the same names from EAS
environment variables.

`EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_ENV` control Sentry crash reporting (also a
public identifier). Leave the DSN empty to keep Sentry off; it is disabled in dev builds
regardless. See [`../docs/firebase-setup.md`](../docs/firebase-setup.md) for the full
observability setup.

## Native identity

`app.json` holds the shared config. `app.config.ts` layers the per-deployment native
identity over it from environment variables, so nothing deployment-specific is committed:

- `OFFICEFC_BUNDLE_ID`: iOS bundle identifier and Android package.
- `OFFICEFC_EAS_PROJECT_ID` / `OFFICEFC_EAS_OWNER`: the EAS project the builds belong to.
- `SENTRY_ORG` / `SENTRY_PROJECT`: optional, for Sentry source-map uploads.

The web build and local development need none of these. See
[Optional: native apps](../docs/self-hosting.md#optional-native-apps).

## Layout

```
app/                   ← Expo Router routes
  _layout.tsx          ← root layout: fonts, auth state, notification routing
  (auth)/              ← sign-in, sign-up, forgot-password
  (onboarding)/        ← verify-email, profile-setup, join
  (public)/            ← privacy, terms, support (no sign-in needed)
  (app)/               ← authenticated app
    _layout.tsx        ← app layout + push token registration
    (tabs)/            ← home, leaderboard, seasons, profile
    log-match.tsx      ← manual, auto-fixture, and photo logging
    confirmations.tsx  ← pending confirmations
    match/[id].tsx     ← match detail
    player/[id].tsx    ← player profile + ELO chart
    h2h.tsx, games.tsx, analytics.tsx
    finals.tsx, cup.tsx, archive/[id].tsx, recap/[seasonId].tsx
    admin.tsx          ← admin dashboard
    settings.tsx, edit-profile.tsx, delete-account.tsx, blocked.tsx, changelog.tsx
src/
  theme/               ← design tokens + font loader
  components/          ← UI primitives and shared components
  screens/             ← larger screen sections (home, admin, brackets, recap, profiles)
  lib/                 ← auth, league data access, notifications, upload, membership,
                         constants, legal copy, formatting, logging
                         (logger/ → Cloud Logging, sentry.ts → crash reporting)
  types.ts             ← shared domain types
assets/                ← app icon / splash / favicon
public/                ← web manifest and icons for the installable web app
```
