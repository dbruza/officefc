# Running M1 locally (auth + membership)

> Historical milestone runbook. For the current setup and release state, see
> [Firebase setup](firebase-setup.md) and the
> [implementation overview](implementation-plan.md).

M1 adds real Firebase auth, profile setup, and invite-code membership, backed by two
Cloud Functions (`redeemInvite`, `createInvite`). Here's how to run and test it end-to-end
against the **Firebase Emulator Suite**.

## One-time install

```bash
# Cloud Functions deps
cd functions && npm install && cd ..

# Rules-test deps (optional, for `npm run test:rules`)
cd test/rules && npm install && cd ..
```

(The Expo app deps are already installed under `mobile/`.)

## Start the stack

```bash
# 1) Build the functions (the emulator runs the compiled lib/).
#    For active development, run `npm --prefix functions run build:watch` in its own terminal.
npm --prefix functions run build

# 2) Boot the emulators (Auth, Firestore, Storage, Functions). UI at http://localhost:4000
firebase emulators:start

# 3) In another terminal, run the app pointing at the emulators.
cd mobile
EXPO_PUBLIC_USE_EMULATORS=1 npm run web      # or: npm run ios / npm run android
```

`mobile/.env` already sets `EXPO_PUBLIC_USE_EMULATORS=1`, so plain `npm run web` works too.

## Test the onboarding flow

1. **Sign up** with `djbruza@gmail.com` (the admin allowlist) + any password.
2. **Verify email:** no real email is sent by the emulator — open the **Auth** tab in the
   Emulator UI (`:4000`), find the user, and use the verification link / mark verified. Back
   in the app, tap **"I've verified — continue."**
3. **Profile setup:** enter a display name, handle, jersey, pick a colour → Continue.
4. **Join:** as the allowlisted admin you'll see "Admin setup" — tap **Create league & join**
   (no code needed). You land on the **home** screen with an **ADMIN** chip.
5. **Generate an invite:** on home, **Generate invite code** → you get an `OFC-XXXXX` code.
6. **Second user:** open a fresh browser/incognito, sign up with another email, verify, set up
   a profile, and **enter the invite code** on the join screen → they land on home as a member.

Watch the **Firestore** tab in the Emulator UI to see `leagues/office/members/*`, `profiles/*`,
and `invites/*` get written.

## Run the security-rules tests

```bash
npm run test:rules    # boots the Firestore emulator and runs test/rules/*.test.mjs
```

These assert the trust boundary: non-members can't read league data, clients can't write
membership/ELO/status, but a user can read their own profile/membership during onboarding.

## Troubleshooting

- **Blank web page + `ERR_CONNECTION_REFUSED` on `:8081`, terminal shows
  `Error: EMFILE: too many open files, watch`** — Metro crashed on macOS's low open-file
  limit while watching the tree. Install Watchman and restart:
  ```bash
  brew install watchman
  cd mobile && npx expo start --web --clear
  ```
  Stopgap without Watchman: `ulimit -n 65536` in the terminal before `npm run web`.
- **App stuck on a spinner / Firebase `ERR_CONNECTION_REFUSED` to `:9099`/`:8080`/`:5001`** —
  the emulators aren't running. Start them (`firebase emulators:start`) in another terminal,
  or set `EXPO_PUBLIC_USE_EMULATORS=0` in `mobile/.env` to hit the live project.

## Notes

- Functions run in the default region `us-central1` (matches the client's `getFunctions`).
- The emulator runs functions with your local Node; a "node version" warning vs. the
  declared `nodejs24` runtime is harmless for local dev.
- Nothing here touches your live Firebase project — emulators are fully local.
