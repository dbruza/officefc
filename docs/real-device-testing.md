# OfficeFC real-device testing

This runbook covers the first end-to-end test on physical iOS and Android devices:
camera/photo selection, AI extraction, private upload, match confirmation, ELO updates,
and push notifications. Native apps are optional; see
[Optional: native apps](self-hosting.md#optional-native-apps) for the bigger picture.

## Recommended setup

Point the phones at a deployed Firebase project, ideally a separate development project
rather than your live league. Do not use `EXPO_PUBLIC_USE_EMULATORS=1`: the
physical-device build does not resolve the development machine's LAN address for the
Firebase emulators.

For the complete confirmation and push flow, use two physical devices and two Firebase
accounts. One device is enough for camera and AI testing, but switching between two users
on one phone unregisters the previous user's push token.

## 1. Accounts and prerequisites

You need:

- Your Firebase project on the Blaze plan, with Email/Password Auth, Firestore, Storage,
  and Functions set up as in the [self-hosting guide](self-hosting.md).
- An Expo account and EAS CLI access.
- A bundle identifier you own, used as `OFFICEFC_BUNDLE_ID` (for example
  `com.acme.officefc`).
- For AI photo reading: an OpenRouter API key and `AI_FEATURES=true` /
  `EXPO_PUBLIC_AI_FEATURES=1`.
- For an EAS-built iPhone app: a paid Apple Developer account and an iPhone with
  Developer Mode enabled.
- For Android: a physical phone with installation from the EAS download link allowed.
- For Android push: Firebase Cloud Messaging V1 credentials and `google-services.json`.

The app already includes `expo-dev-client`, camera, image picker, and notifications.
Expo requires a development build rather than Expo Go for remote push testing.

## 2. Verify the repository first

From the repository root:

```bash
npm test
npm --prefix functions test
npm --prefix mobile run typecheck
npm --prefix mobile run export:web
cd mobile
npx expo-doctor
```

## 3. Configure and deploy Firebase

Confirm the CLI is targeting the intended project:

```bash
npx firebase login
npx firebase use
```

If it shows the wrong project, switch with `npx firebase use <alias-or-project-id>`, or add
one with `npx firebase use --add`.

With AI on, store the OpenRouter key in Secret Manager. Do not put it in `mobile/.env`:

```bash
npx firebase functions:secrets:set OPENROUTER_API_KEY
```

Deploy the backend, indexes, and security rules:

```bash
npm run deploy:backend
```

In the Firebase console, confirm:

- Authentication > Sign-in method > Email/Password is enabled.
- Firestore and Storage exist in the same project used by the app.
- Functions includes `submitAiAssistedMatch`, `getMatchPhotoUrl`, the match lifecycle
  functions, and the scheduled functions, plus `extractMatchStats` and `analyzeMatch` when
  `AI_FEATURES=true`.
- The `OPENROUTER_API_KEY` secret is attached to `extractMatchStats` (AI only).

Official references:

- [Firebase function secrets](https://firebase.google.com/docs/functions/config-env#secret_parameters)
- [Firebase deployment](https://firebase.google.com/docs/cli#deployment)

## 4. Link the Expo project

From `mobile/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

Select or create your OfficeFC EAS project. `mobile/app.config.ts` reads the project from
environment variables rather than `app.json`, so `init` may print the project ID for you to
add instead of writing it. Keep the ID (also shown on the project's page at expo.dev) for
the next step as `OFFICEFC_EAS_PROJECT_ID`, along with the owning account or organisation
as `OFFICEFC_EAS_OWNER`.

Do not build without `OFFICEFC_EAS_PROJECT_ID`; push-token registration depends on it.

## 5. Add the app configuration

Copy the exact Firebase web app values from Firebase console > Project settings > Your apps
> Web app into `mobile/.env`:

```dotenv
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_USE_EMULATORS=0
EXPO_PUBLIC_FUNCTIONS_REGION=...
EXPO_PUBLIC_AI_FEATURES=...
```

Create the same variables in the EAS `development` environment, together with the
deployment's other `EXPO_PUBLIC_*` settings (admin emails, operator name, support email,
web URL) and the native identity variables. They are client-visible configuration, so use
`plaintext` visibility:

```bash
npx eas-cli@latest env:create --environment development --visibility plaintext --name OFFICEFC_BUNDLE_ID --value "com.acme.officefc"
npx eas-cli@latest env:create --environment development --visibility plaintext --name OFFICEFC_EAS_PROJECT_ID --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name OFFICEFC_EAS_OWNER --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_API_KEY --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_PROJECT_ID --value "your-project-id"
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_APP_ID --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FUNCTIONS_REGION --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_AI_FEATURES --value "..."
```

`EXPO_PUBLIC_USE_EMULATORS=0` is already set per profile in `eas.json`. Verify the list:

```bash
npx eas-cli@latest env:list --environment development
```

When you run `eas` commands locally, also export `OFFICEFC_BUNDLE_ID`,
`OFFICEFC_EAS_PROJECT_ID`, and `OFFICEFC_EAS_OWNER` in your shell so the CLI resolves the
same project as the cloud build.

Reference: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

## 6. Configure push credentials

### iOS

Register the phone before the first build:

```bash
npx eas-cli@latest device:create
```

When EAS asks about push notifications during the first build, allow it to configure
the APNs key. A paid Apple Developer account is required for an EAS iPhone build.

### Android

1. Register an Android app in the Firebase console, using your `OFFICEFC_BUNDLE_ID` as the
   package name.
2. Download `google-services.json` into `mobile/google-services.json`.
3. Add this field under `expo.android` in `mobile/app.json` in your fork:

```json
"googleServicesFile": "./google-services.json"
```

4. Generate a Google service-account key in Firebase console > Project settings >
   Service accounts.
5. Run `npx eas-cli@latest credentials`, choose Android, then upload the key as the
   FCM V1 push notification credential.
6. Never commit the service-account private key. `google-services.json` itself contains
   public app identifiers, but review it before deciding whether to commit it.

Reference: [Expo FCM V1 setup](https://docs.expo.dev/push-notifications/fcm-credentials/).

## 7. Build and install

From `mobile/`:

```bash
npx eas-cli@latest build --platform ios --profile development
npx eas-cli@latest build --platform android --profile development
```

Install from the EAS build page or QR/link shown by the CLI. An iOS development build
only installs on devices included in its provisioning profile; rebuild after registering
a new iPhone.

Reference: [Create an Expo development build](https://docs.expo.dev/develop/development-builds/create-a-build/).

## 8. Start the development server

Keep the computer and phones on the same network, then:

```bash
cd mobile
npx expo start
```

Open the installed OfficeFC development build and scan the QR code. If the network blocks
LAN discovery:

```bash
npx expo start --tunnel
```

The JavaScript bundle uses `mobile/.env`, so confirm it still has
`EXPO_PUBLIC_USE_EMULATORS=0`.

## 9. Create two test users

1. On device A, sign up with an email listed in `ADMIN_EMAILS` (or use an account that is
   already a league admin).
2. Complete real email verification, profile setup, and admin league setup.
3. Copy the join code or invite link from the admin dashboard.
4. On device B, sign up with a second email, verify it, create a profile, and join with
   the code.
5. In Firestore, confirm each signed-in device writes a document under
   `deviceTokens/{uid}/tokens/{tokenId}` after notification permission is granted.

If no token appears, first check that `OFFICEFC_EAS_PROJECT_ID` is set in the EAS
environment the build used, then check APNs/FCM credentials.

## 10. Test matrix

### Manual match

1. Device A logs a manual match against device B.
2. Device B receives one `match_pending` push.
3. Device B opens OfficeFC and confirms the result.
4. Device A receives `match_confirmed`.
5. Verify the match has ELO before/after/delta values and the standings changed.

### AI-assisted match

Only with AI features on.

1. Device A chooses Log match > Photo.
2. Take a clear photo of an EA SPORTS FC full-time stats screen.
3. Confirm upload and extraction complete.
4. Check the detected score and stats, edit at least one value, choose the opponent,
   side, and teams, then submit.
5. Confirm the match remains `pending_confirmation` until device B accepts it.
6. Open match detail and verify the private photo and recorded stats render.
7. As the submitter, delete the photo and verify it can no longer be loaded.

For the first pass, prefer a JPEG or PNG. Photo-library HEIC/HEIF files are not currently
accepted by the extraction backend.

### Security regression

1. Submit the same AI draft twice by retrying after a slow response.
2. Verify only one match exists and only one pending notification is sent.
3. Verify an existing manual or confirmed match is never replaced.

### Failure behavior

- Deny camera permission and verify manual logging still works.
- Use a non-stats image and verify the app falls back without submitting.
- Turn off networking during extraction and verify no match is created.
- Reject notification permission and verify the app still starts normally.

## 11. Record evidence

For each platform, record:

- OS version and device model.
- EAS build ID and Git commit.
- Successful camera and photo-library inputs.
- AI score accuracy and any edited fields.
- Push received foreground, background, and app-closed.
- Match confirmation and final ELO values.
- Any console, Functions, or crash logs.

Do not call AI device validation complete until real images meet the eval gate in
[`eval/README.md`](../eval/README.md): at least 20 readable images, 5 unreadable/non-stats
images, and at least 90% exact two-sided score accuracy.
