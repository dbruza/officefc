# Firebase Setup

OfficeFC uses Firebase Authentication, Firestore, Storage, Cloud Functions, Hosting, and
the local Emulator Suite.

## Requirements

- Node.js 20
- Java 21
- A Firebase project on the Blaze plan for deployed Functions and Storage

The Firebase CLI is pinned in the root development dependencies, so use it through `npx`
or the repository scripts.

## Create The Project

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com).
2. Enable email/password Authentication.
3. Create Firestore and Storage in the same region.
4. Register a Firebase web app.
5. Copy `mobile/.env.example` to `mobile/.env`.
6. Paste the web app configuration into the matching `EXPO_PUBLIC_FIREBASE_*` variables.

Firebase web configuration is public client metadata, not a secret. Authorization is
enforced by `firestore.rules`, `storage.rules`, and trusted Cloud Functions.

## Connect The CLI

From the repository root:

```bash
npx firebase login
npx firebase use --add
```

Choose the project and assign the `default` alias. The production deployment scripts
explicitly target the `office-fc` project.

## Local Development

Set this value in `mobile/.env`:

```dotenv
EXPO_PUBLIC_USE_EMULATORS=1
```

Start the emulators:

```bash
npx firebase emulators:start
```

In another terminal:

```bash
npm --prefix mobile run web
```

The Emulator UI is available at <http://localhost:4000>. Default service ports are defined
in `firebase.json`.

## Verify Security Rules

Install the rules-test workspace and run the emulator-backed suite:

```bash
npm --prefix test/rules ci
npm run test:rules
```

These tests cover league membership boundaries, trusted match fields, onboarding reads,
team validation, and private match-photo access.
