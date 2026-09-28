# OfficeFC real-device testing

This runbook covers the first end-to-end test on physical iOS and Android devices:
camera/photo selection, AI extraction, private upload, match confirmation, ELO updates,
and push notifications.

## Recommended setup

Use the deployed `office-fc` Firebase development project from the phones. Do not use
`EXPO_PUBLIC_USE_EMULATORS=1`: the current physical-device build does not resolve the
development Mac's LAN address for Firebase emulators.

For the complete confirmation and push flow, use two physical devices and two Firebase
accounts. One device is enough for camera and AI testing, but signing between two users
on one phone unregisters the previous user's push token.

## 1. Accounts and prerequisites

You need:

- Firebase project `office-fc` on the Blaze plan, with Email/Password Auth, Firestore,
  Storage, and Functions enabled.
- An Expo account and EAS CLI access.
- An OpenRouter API key (photo stats extraction).
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

Confirm the CLI is targeting the intended development project:

```bash
firebase login
firebase use
```

The result should identify `office-fc`. If it does not:

```bash
firebase use office-fc
```

Store the OpenRouter key in Secret Manager. Do not put it in `mobile/.env`:

```bash
firebase functions:secrets:set OPENROUTER_API_KEY
```

Deploy the backend, indexes, and security rules:

```bash
firebase deploy --only firestore,storage,functions
```

In Firebase Console, confirm:

- Authentication > Sign-in method > Email/Password is enabled.
- Firestore and Storage exist in the same project used by the app.
- Functions includes `extractMatchStats`, `submitAiAssistedMatch`,
  `getMatchPhotoUrl`, match lifecycle functions, and scheduled functions.
- The `OPENROUTER_API_KEY` secret is attached to `extractMatchStats`.

Official references:

- [Firebase function secrets](https://firebase.google.com/docs/functions/config-env#secret_parameters)
- [Firebase deployment](https://firebase.google.com/docs/cli#deployment)

## 4. Link the Expo project

From `mobile/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

Select or create the OfficeFC EAS project. Then check `mobile/app.json`:

```json
"extra": {
  "eas": {
    "projectId": "a-real-eas-project-uuid"
  }
}
```

Do not build while `projectId` is `null`; push-token registration depends on it.

## 5. Add Firebase client configuration

Copy the exact Firebase Web App values from Firebase Console > Project settings >
Your apps > Web app into `mobile/.env`:

```dotenv
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=office-fc
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_USE_EMULATORS=0
```

Also create these seven variables in the EAS `development` environment. They are
client-visible Firebase configuration, so use `plaintext` visibility:

```bash
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_API_KEY --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_PROJECT_ID --value "office-fc"
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_FIREBASE_APP_ID --value "..."
npx eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_USE_EMULATORS --value "0"
```

Verify them:

```bash
npx eas-cli@latest env:list --environment development
```

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

1. Register an Android app with package `com.officefc.app` in Firebase Console.
2. Download `google-services.json` into `mobile/google-services.json`.
3. Add this field under `expo.android` in `mobile/app.json`:

```json
"googleServicesFile": "./google-services.json"
```

4. Generate a Google service-account key in Firebase Console > Project settings >
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

Keep the Mac and phones on the same network, then:

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

1. On device A, sign up with the allowlisted admin email `djbruza@gmail.com`.
2. Complete real email verification, profile setup, and admin league setup.
3. Generate an invite code.
4. On device B, sign up with a second email, verify it, create a profile, and redeem
   the invite.
5. In Firestore, confirm each signed-in device writes a document under
   `deviceTokens/{uid}/tokens/{tokenId}` after notification permission is granted.

If no token appears, first check that `app.json` has a non-null EAS `projectId`, then
check APNs/FCM credentials.

## 10. Test matrix

### Manual match

1. Device A logs a manual match against device B.
2. Device B receives one `match_pending` push.
3. Device B opens OfficeFC and confirms the result.
4. Device A receives `match_confirmed`.
5. Verify the match has ELO before/after/delta values and the standings changed.

### AI-assisted match

1. Device A chooses Log match > Snap result.
2. Take a clear photo of a FIFA 23 full-time stats screen.
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
- Any console, Functions, or Crash logs.

Do not call AI device validation complete until real images meet the eval gate in
`eval/README.md`: at least 20 readable images, 5 unreadable/non-stats images, and at
least 90% exact two-sided score accuracy.
