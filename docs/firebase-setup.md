# Firebase setup (do this once, then I resume at M1)

Goal: a dev Firebase project + local tooling so auth, Firestore, Storage, and Cloud
Functions can run — both locally (Emulator Suite) and deployed. Everything here is on the
**same Cloud Billing account as your GCP credits**, so it draws down credits, not cash.

## 1. Install local tooling

```bash
# Firebase CLI
npm install -g firebase-tools

# Java runtime (required by the Firestore/Storage/Auth emulators)
brew install --cask temurin          # or: brew install openjdk@17
java -version                        # confirm it resolves
```

## 2. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project** (e.g. `officefc-dev`).
   - When asked, attach it to the **billing account that has your credits**.
2. **Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions (2nd gen) and Storage
   need Blaze; your credits cover the (near-zero, office-scale) usage.
3. Enable the products we use:
   - **Authentication** → Sign-in method → enable **Email/Password**.
   - **Firestore Database** → Create database → **production mode** → pick a region
     (e.g. `us-central1` or your nearest).
   - **Storage** → Get started → same region.

## 3. Register a Web app + fill env

1. Project settings (gear) → **Your apps** → **</> Web** → register (nickname `officefc`).
2. Copy the `firebaseConfig` values into `mobile/.env` (copy from `mobile/.env.example`):

```bash
cd mobile
cp .env.example .env
# then paste: EXPO_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID,
# STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID
```

These values are **not secret** (access is governed by security rules), so committing a
`.env` is optional — `.gitignore` excludes it by default.

## 4. Point the CLI at your project

```bash
# from the repo root (/Users/dbmac/Desktop/Dev/FifaApp)
firebase login
firebase use --add          # pick your project, alias it "default"
```

This rewrites `.firebaserc` to your real project id (currently a placeholder `officefc-dev`).

## 5. Verify it works

```bash
# Repo root: boot the emulators (uses firebase.json + the rules I committed)
firebase emulators:start
#   → Emulator UI: http://localhost:4000
#   → Auth :9099 · Firestore :8080 · Storage :9199
#   (Functions + Pub/Sub emulators are added in M2/M5, when there's function code.)

# In another terminal: run the app
cd mobile
npm run web        # or: npm run ios / npm run android
```

**What "done" looks like right now:** the Emulator UI loads at :4000 and the app boots.
That's the bar for this step. The current screen is the **M0 design-system showcase**, which
renders from *mock data* and does **not** call Firebase yet — so filling `.env` is prep for
M1, and a clean boot confirms the toolchain, not the wiring. I exercise the real Auth/
Firestore/Storage connections in M1 (that's when `EXPO_PUBLIC_USE_EMULATORS=1` starts to
matter).

> Emulators run **free regardless of billing plan**. Blaze is only needed to *deploy*
> Functions/Storage later — enabling it now (credits cover it) just avoids a step in M2.

## What I do next (M1)

Once you confirm, I'll build:
- Email/password **sign-up / sign-in** (+ verification, password reset) screens.
- **Profile setup** (name, handle, jersey, avatar colour).
- **Admin invite-code join** into the single office league, with the `invites` /
  `leagues/office/members` model and an **admin email allowlist** for bootstrapping.
- Tightened **Firestore + Storage rules** with **`@firebase/rules-unit-testing`** specs
  (a non-member can't read; a non-participant can't confirm).
- A `functions/` workspace (Node) scaffold for the trusted writes that follow in M2.

I can write all of that here; you'll run `firebase emulators:exec`/the app to see it live.
