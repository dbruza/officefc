# Self-hosting OfficeFC

This guide takes you from nothing to a running league that your colleagues can join. It
assumes you're comfortable with a terminal but have not used Firebase before. Allow about
an hour, most of it waiting for Firebase.

What you end up with:

- The OfficeFC web app on Firebase Hosting at `https://<your-project-id>.web.app` (or your
  own domain). Players can install it to their home screen as a PWA.
- A Firebase backend in your own Google account: sign-in, the league database, Cloud
  Functions, and scheduled jobs.
- You as the first league admin, with an invite link to share.

One deployment runs one league. Running several leagues from one deployment isn't
supported yet; give each league its own Firebase project.

Native iOS and Android apps are optional and covered at the end, in
[Optional: native apps](#optional-native-apps). Most leagues don't need them.

Contents:

- [Before you start](#before-you-start)
- [Get the code](#1-get-the-code)
- [Create the Firebase project](#2-create-the-firebase-project)
- [Enable Firebase services](#3-enable-firebase-services)
- [Register a web app](#4-register-a-web-app)
- [Connect the Firebase CLI](#5-connect-the-firebase-cli)
- [Configure the app](#6-configure-the-app)
- [Configure Cloud Functions](#7-configure-cloud-functions)
- [Deploy the backend](#8-deploy-the-backend)
- [Deploy the web app](#9-deploy-the-web-app)
- [Set up your league](#10-set-up-your-league)
- [Optional: AI photo reading](#optional-ai-photo-reading)
- [Optional: custom domain](#optional-custom-domain)
- [Legal pages](#legal-pages)
- [Updating to a new release](#updating-to-a-new-release)
- [Costs](#costs)
- [Troubleshooting](#troubleshooting)
- [Optional: native apps](#optional-native-apps)
- [Configuration reference](#configuration-reference)

## Before you start

You need:

- **Node.js 24** and npm. The repository's `.nvmrc` pins the version if you use `nvm`.
- **Git**.
- **A Google account** that can create Firebase projects and attach a billing account (a
  credit card). A company Google Workspace account works, but see the note on
  [organisation policies](#callables-fail-with-a-cors-error-and-the-region-is-right).
- **Java 21**, only if you want to run the local emulators or the test suite. Deploying
  doesn't need it.

You don't need to install the Firebase CLI globally. It is pinned in the repository's
development dependencies, and every command below runs it through `npx`.

Decide up front:

- **Region.** Where your league's data lives. Pick one close to your players; Firestore's
  location can't be changed later.
- **Admin emails.** The address (or addresses) of whoever will run the league. They become
  admins when they first join.
- **AI photo reading, on or off.** Off is simpler and free. You can turn it on later. See
  [Optional: AI photo reading](#optional-ai-photo-reading).

## 1. Get the code

Fork [dbruza/officefc](https://github.com/dbruza/officefc) on GitHub and clone your fork,
or clone the original directly. If you want your copy to be private, clone it and push it
to a new private repository instead of forking.

```bash
git clone https://github.com/<you>/officefc.git
cd officefc
git remote add upstream https://github.com/dbruza/officefc.git   # for updates later

npm ci
npm --prefix mobile ci
npm --prefix functions ci
```

## 2. Create the Firebase project

1. Open the [Firebase console](https://console.firebase.google.com) and choose **Create a
   project**. Note the **project ID** it shows (for example `acme-officefc`); you'll use it
   throughout. Google Analytics isn't needed.
2. Upgrade the project to the **Blaze (pay-as-you-go)** plan: choose **Upgrade** in the
   console and attach a billing account. Cloud Functions, Cloud Storage, and Cloud
   Scheduler require it. A typical office league stays within the free usage tiers;
   see [Costs](#costs).
3. Set a **budget alert**. In the [Google Cloud console](https://console.cloud.google.com),
   open **Billing → Budgets & alerts** and create a budget for the project (for example
   US$10 a month) with email alerts. A budget alerts you; it does not cap spending.

## 3. Enable Firebase services

In the Firebase console, under **Build**:

1. **Authentication → Get started → Sign-in method → Email/Password → Enable.** Leave
   "Email link (passwordless sign-in)" off.
2. **Firestore Database → Create database.** Use the default database, choose a location,
   and start in **production mode** (you'll deploy the real rules in a moment). If asked for
   an edition, choose Standard.
3. **Storage → Get started.** Use the **same location** as Firestore and production mode.
   Storage holds match photos for AI photo reading, but create it even if AI is off:
   deploying the backend deploys Storage rules, which needs a bucket.

### Choosing a region

Cloud Functions should run in the same region as your Firestore database, so requests
don't travel further than they need to. Use this as `FUNCTIONS_REGION` in step 7:

| Firestore location                   | `FUNCTIONS_REGION`                   |
| ------------------------------------ | ------------------------------------ |
| `nam5` (United States multi-region)  | `us-central1`                        |
| `eur3` (Europe multi-region)         | `europe-west1`                       |
| A single region, e.g. `europe-west2` | The same region, e.g. `europe-west2` |

### Storage needs to read Firestore

`storage.rules` checks league membership with `firestore.get()`. In a deployed project the
Firebase Storage service account
`service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com` must have the
**Firebase Rules Firestore Service Agent** (`roles/firebaserules.firestoreServiceAgent`)
role. Without it, valid member uploads fail with `storage/unauthorized`, even though the
same rules pass in the local emulators.

The Firebase CLI or console normally offers to grant this the first time cross-service
Storage rules are deployed; say yes. You can check the grant in Google Cloud console →
**IAM**, with **Include Google-provided role grants** ticked. Your project number is under
Firebase console → Project settings → General.

## 4. Register a web app

Firebase console → **Project settings → General → Your apps → Add app → Web** (`</>`).
Give it a nickname such as "OfficeFC web". You don't need to tick "Also set up Firebase
Hosting"; the repository's `firebase.json` already configures it.

Firebase then shows a `firebaseConfig` object. Keep the page open; you need its six values
in step 6. You can find them again later under **Project settings → Your apps → SDK setup
and configuration**.

These values are public client metadata, not secrets. Access is enforced by
`firestore.rules`, `storage.rules`, and the Cloud Functions.

## 5. Connect the Firebase CLI

From the repository root:

```bash
npx firebase login
npx firebase use --add
```

Choose your project and give it the alias `default`. This writes `.firebaserc`, which is
gitignored, so every deploy script targets your project. `npx firebase use` shows the
active project at any time.

## 6. Configure the app

```bash
cp mobile/.env.example mobile/.env
```

The example file is set up for the local emulators. Replace the Firebase values with the
ones from step 4 (copy them exactly, don't hand-type the domains) and fill in the rest:

```dotenv
EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=acme-officefc.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=acme-officefc
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=acme-officefc.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
EXPO_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:0123456789abcdef

EXPO_PUBLIC_USE_EMULATORS=0
EXPO_PUBLIC_FUNCTIONS_REGION=europe-west2
EXPO_PUBLIC_AI_FEATURES=0

EXPO_PUBLIC_OPERATOR_NAME="Acme Ltd's social committee"
EXPO_PUBLIC_SUPPORT_EMAIL=officefc@acme.example
EXPO_PUBLIC_DATA_LOCATION="London, United Kingdom"
```

- `EXPO_PUBLIC_USE_EMULATORS` must be `0` for anything you deploy.
- `EXPO_PUBLIC_FUNCTIONS_REGION` must equal `FUNCTIONS_REGION` in the next step.
- `EXPO_PUBLIC_AI_FEATURES` must match `AI_FEATURES`. Leave it `0` for now unless you are
  setting up AI photo reading.
- `EXPO_PUBLIC_OPERATOR_NAME`, `EXPO_PUBLIC_SUPPORT_EMAIL`, and `EXPO_PUBLIC_DATA_LOCATION`
  appear in the privacy policy and terms. See [Legal pages](#legal-pages).

The [configuration reference](#configuration-reference) lists every setting, including the
optional logging and Sentry ones.

## 7. Configure Cloud Functions

Cloud Functions settings are
[Firebase parameters](https://firebase.google.com/docs/functions/config-env), stored per
project in `functions/.env.<projectId>` (gitignored):

```bash
cp functions/.env.example functions/.env.acme-officefc   # use your project ID
```

Edit it:

```dotenv
FUNCTIONS_REGION=europe-west2
ADMIN_EMAILS=alex@acme.example
AI_FEATURES=false
SENTRY_DSN=
```

- `FUNCTIONS_REGION`: from [Choosing a region](#choosing-a-region). Default `us-central1`.
- `ADMIN_EMAILS`: comma-separated. These accounts join as admins without a code. Only
  accounts that haven't joined yet are affected, and changes take effect on the next
  backend deploy.
- `AI_FEATURES`: `true` deploys the AI photo-reading (`extractMatchStats`) and
  match-analysis (`analyzeMatch`) functions. Leave `false` for now.
- `SENTRY_DSN`: optional. Leave empty to keep Sentry off.

If you skip this step, `firebase deploy` asks for each value on the first deploy and saves
your answers to the same file. Creating it yourself is safer: `npm run validate:web-env`
reads it to check that the app and the functions agree on region and AI settings, and it
can only do that once the file exists.

## 8. Deploy the backend

```bash
npm run deploy:backend
```

This validates `mobile/.env`, then deploys the Firestore rules and indexes, the Storage
rules, and every Cloud Function (including the scheduled jobs) to the active project.

On the first deploy, expect the CLI to:

- enable several Google Cloud APIs (Cloud Functions, Cloud Build, Artifact Registry, Cloud
  Run, Eventarc, Cloud Scheduler, and others). This can take a few minutes;
- offer to grant the Storage service agent its Firestore role (say yes);
- ask how long to keep built container images (the default is fine).

A first deploy sometimes fails with a message that 2nd gen functions are still being set
up, or with an Eventarc or service-agent permission error. Wait a few minutes and run
`npm run deploy:backend` again; new projects take a while for permissions to propagate.

Firestore builds the composite indexes in the background after the deploy. On an empty
database this takes a few minutes; you can watch progress under Firestore → Indexes.

## 9. Deploy the web app

```bash
npm run deploy:web
```

This validates `mobile/.env` again, builds the production web export into `mobile/dist`,
and deploys it to Firebase Hosting. When it finishes, open
`https://<your-project-id>.web.app`.

`npm run deploy:mvp` does steps 8 and 9 in one command. It's convenient for later
releases; for the first deploy, running them separately makes problems easier to spot.

## 10. Set up your league

### Bootstrap the first admin

1. Open your web app and **sign up** with an email address listed in `ADMIN_EMAILS`.
2. **Verify your email.** Firebase sends the link from
   `noreply@<your-project-id>.firebaseapp.com`; check your spam folder if it doesn't
   arrive.
3. **Complete your profile** (display name, handle, number, colour).
4. The join screen shows **Admin setup**. Press **Create league & join**.

The backend creates the league, a starting season with its join code, and the team
catalogue, and makes you an admin.

### Set up your first season

The starting season is a placeholder called "New season" that runs for three months from
the day you bootstrap, so the league works straight away. You can play it as it is.
Seasons aren't renamed in place, so to use your own name and dates:

1. Open **Admin → Seasons → New season**, enter a name, start, and end, and choose **Create
   season**.
2. **Activate** the new season. Only one season is active at a time; activating it
   deactivates the placeholder.

Later, always create and activate the next season before you finalize the current one.

### Invite players

The admin dashboard's invite card shows the active season's join code with **Copy code**,
**Copy invite link**, and **Share invite**. The invite link
(`https://<your-domain>/join?code=OFC-XXXXX`) fills the code in for the player, even if
they have to sign up first.

- Join codes belong to a season. After you activate a new season, share its code; players
  who already joined stay members.
- If a code leaks, **Rotate** it. The old code stops working.
- To add more admins, list their emails in `ADMIN_EMAILS` before they join, then redeploy
  the backend. The allowlist only takes effect once the address is verified, and it never
  ships in the app: the join screen asks the server. To promote someone who has
  already joined, set `role` to `admin` on their `leagues/office/members/{uid}` document in
  the Firestore console.

### Email verification

Every player must verify their email before they can join. Verification and password-reset
emails come from Firebase. To change the sender name, subject, or wording, edit them under
Authentication → **Templates**. Corporate mail filters sometimes quarantine these emails;
ask players to check spam, or ask IT to allow the sender.

### Installing the web app

Players can install OfficeFC like an app: on iPhone, Safari → Share → **Add to Home
Screen**; on Android, Chrome's menu → **Install app**; on desktop Chrome or Edge, the
install icon in the address bar. Push notifications are only available in the native apps.

## Optional: AI photo reading

With AI on, players can photograph the end-of-match stats screen and the app pre-fills the
score and stats for them to check. An optional match analysis writes a short summary of a
confirmed match. Both use [OpenRouter](https://openrouter.ai), which you pay for per use.
Players are asked for permission before their first photo is sent, and manual logging
always remains available.

1. Create an OpenRouter account and an API key, and add credit.
2. Store the key in Secret Manager (never in a `.env` file):

   ```bash
   npx firebase functions:secrets:set OPENROUTER_API_KEY
   ```

3. Set `AI_FEATURES=true` in `functions/.env.<projectId>` and `EXPO_PUBLIC_AI_FEATURES=1`
   in `mobile/.env`.
4. Deploy both halves:

   ```bash
   npm run deploy:backend
   npm run deploy:web
   ```

5. Let the functions sign photo URLs. Match photos are private and are opened through
   short-lived signed URLs, which needs the functions' runtime service account
   (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) to hold the **Service Account
   Token Creator** role on itself. In Google Cloud console → **IAM & Admin → Service
   accounts**, open the default compute service account, then **Permissions → Grant
   access**: add the same service account as the principal with the Service Account Token
   Creator role. With `gcloud`:

   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     PROJECT_NUMBER-compute@developer.gserviceaccount.com \
     --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
     --role="roles/iam.serviceAccountTokenCreator" --project=YOUR_PROJECT_ID
   ```

The models are configured in `functions/src/extract/core` (photo reading) and
`functions/src/matchAnalysis/core` (match analysis). If you change them, update the app
copy that names the model to match: the privacy policy (`mobile/src/lib/legal.ts`), the AI
consent step (`mobile/src/components/SnapFlow/steps.tsx`), and the AI setting in
`mobile/app/(app)/settings.tsx`.

To rotate the key, run the `secrets:set` command again and redeploy the backend so new
instances pick it up.

To check accuracy on your own photos before you rely on it, use the
[extraction eval](../eval/README.md).

## Optional: custom domain

1. Firebase console → **Hosting → Add custom domain**, enter the domain (for example
   `officefc.acme.example`), and add the DNS records the wizard shows at your DNS provider.
   Use the values Firebase displays; don't copy them from anywhere else. Provisioning the
   certificate can take a few hours.
2. Authentication → **Settings → Authorized domains → Add domain**, and add the custom
   domain. `<project-id>.web.app` and `<project-id>.firebaseapp.com` are already listed;
   keep them.
3. Set `EXPO_PUBLIC_WEB_URL=https://officefc.acme.example` in `mobile/.env` and redeploy the
   web app. The web app builds invite links from the address it's opened at; the native apps
   use this setting.

## Legal pages

OfficeFC includes a privacy policy, terms of use, and a support page at `/privacy`,
`/terms`, and `/support`, also linked inside the app and required at sign-up. They are a
starting point written for the original deployment, not legal advice.

**You, as the operator of your deployment, are responsible for them.** Before you invite
anyone:

- Set `EXPO_PUBLIC_OPERATOR_NAME` (who runs the league, for example "Acme Ltd's social
  committee"), `EXPO_PUBLIC_SUPPORT_EMAIL` (a mailbox someone reads), and
  `EXPO_PUBLIC_DATA_LOCATION` (where your Firestore database is, for example "Sydney,
  Australia").
- Read the copy in `mobile/src/lib/legal.ts` and change anything that doesn't match how you
  run your league or the laws that apply to you. It names the services the app can use
  (Firebase, Expo push, Sentry, OpenRouter); remove any you don't use. With
  `EXPO_PUBLIC_AI_FEATURES=0`, the AI and OpenRouter paragraphs are left out automatically.
  Bump `LEGAL_UPDATED` in that file when you change it.
- Redeploy the web app after changing either.

## Updating to a new release

Releases are listed in [CHANGELOG.md](../CHANGELOG.md). Read the entries since your last
update first: a release can add a function parameter (the deploy will ask for it) or a new
app setting (compare `mobile/.env.example` with your `mobile/.env`).

```bash
git fetch upstream
git merge upstream/main          # resolve conflicts in any files you've customised

npm ci
npm --prefix mobile ci
npm --prefix functions ci

npm run deploy:backend           # rules, indexes, and functions first
npm run deploy:web               # then the web app
```

Deploy the backend first and let any new indexes finish building (Firestore → Indexes)
before deploying the web app, so the new app never queries an index that isn't ready.

If the release notes say the bundled team catalogue changed, open **Admin → Teams** and use
**Update team catalogue** to switch the team picker over. Retired teams keep their ratings
on past matches, and custom teams stay.

If a release goes wrong, roll the web app back from Firebase console → Hosting → **Release
history**, and redeploy the backend from the previous release's commit. Don't delete data
as a way of rolling back. The [web release runbook](web-mvp-launch.md) has a fuller
checklist, including a smoke test.

## Costs

The Blaze plan is pay-as-you-go but includes the same free usage as the free plan. For an
office league of a few dozen players, Firestore reads and writes, function invocations,
Hosting, and Authentication normally stay inside the free tiers. Check
[Firebase pricing](https://firebase.google.com/pricing) for current numbers.

What you may pay for:

- **Cloud Scheduler.** OfficeFC deploys six scheduled jobs (reminders, auto-confirm,
  weekly leaderboard snapshots, cleanup, notification retries, and read-model recovery).
  Google Cloud includes a small number of free jobs per billing account and charges a few
  cents per job per month after that.
- **Cloud Storage.** Only used for AI match photos. The no-cost Storage allowance applies to
  buckets in some US regions; elsewhere a small league's photos cost cents.
- **Artifact Registry.** Function container images are stored between deploys. The cleanup
  policy set on the first deploy keeps this small.
- **OpenRouter**, if AI is on: billed by OpenRouter per request, separately from Google.

Set a [budget alert](#2-create-the-firebase-project) either way.

## Troubleshooting

### Callables fail with a CORS error or a 404

The app is calling functions in a different region from the one they're deployed to.
`EXPO_PUBLIC_FUNCTIONS_REGION` in `mobile/.env` must equal `FUNCTIONS_REGION` in
`functions/.env.<projectId>`. Run `npm run validate:web-env` to check, fix whichever is
wrong, and redeploy the web app (and the backend, if you changed `FUNCTIONS_REGION`).

If you change `FUNCTIONS_REGION` after the first deploy, `firebase deploy` creates the
functions in the new region and offers to delete the old ones.

### Callables fail with a CORS error and the region is right

Cloud Functions v2 runs each callable as a Cloud Run service, and browsers can only reach
it when `allUsers` holds the **Cloud Run Invoker** role on that service. If the binding is
missing, Google rejects the browser's preflight request with a 403 before the function
runs, and the browser reports it as a CORS error.

To confirm, send a preflight to the function's URL (shown in Firebase console → Functions):

```bash
curl -i -X OPTIONS https://REGION-PROJECT_ID.cloudfunctions.net/redeemInvite \
  -H "Origin: https://PROJECT_ID.web.app" -H "Access-Control-Request-Method: POST"
```

A `403` from `Google Frontend` means the binding is missing; a working function returns
`204`. `firebase deploy` only sets the binding when it creates a function, so redeploying an
existing function doesn't fix it. Either delete and recreate the function:

```bash
npx firebase functions:delete redeemInvite --region REGION
npm run deploy:backend
```

or add the binding directly (the Cloud Run service name is the function name in lower
case):

```bash
gcloud run services add-iam-policy-binding redeeminvite --region=REGION \
  --member=allUsers --role=roles/run.invoker --project=PROJECT_ID
```

If the grant is refused, your Google Workspace organisation probably restricts sharing
with `allUsers` (the "Domain restricted sharing" organisation policy). Ask your Google Cloud
administrator for an exception for this project, or create the project outside the
organisation.

### Photo uploads fail with `storage/unauthorized`

The Storage service agent is missing the Firebase Rules Firestore Service Agent role. See
[Storage needs to read Firestore](#storage-needs-to-read-firestore).

### Match photos won't open

If the function logs show `Permission 'iam.serviceAccounts.signBlob' denied`, the runtime
service account can't sign URLs. Grant it the Service Account Token Creator role on itself
(step 5 of [Optional: AI photo reading](#optional-ai-photo-reading)). Photo viewing also
doesn't work in the local emulators, because they can't sign URLs.

### `validate:web-env` rejects `mobile/.env`

It lists every problem at once. Common ones:

- The project ID doesn't match the active project: run `npx firebase use` to see which
  project is active, and switch with `npx firebase use <alias-or-id>` or fix `mobile/.env`.
- `EXPO_PUBLIC_USE_EMULATORS` isn't `0`, or the Firebase values are still the
  `demo-officefc` ones: you're still using the emulator configuration from the example.
- A value doesn't look like a real Firebase value: copy it again from the console.
- AI is on in the app but not in `functions/.env.<projectId>`: turn both on or both off.

### The first deploy fails partway

New projects take a few minutes to enable APIs and propagate service-agent permissions.
Wait and run `npm run deploy:backend` again. In a non-interactive shell (such as CI), the
deploy can't ask for missing parameters, so create `functions/.env.<projectId>` first.

### "The query requires an index" after a deploy

The new indexes are still building. Check Firestore → Indexes and try again once they show
as enabled.

### A blank white page after deploying the web app

A browser holding a cached copy from before the deploy can show a blank page. A
cache-bypassing reload (Ctrl/Cmd+Shift+R) fixes it. The
[web release runbook](web-mvp-launch.md#hosting-cache-invariants) explains the Hosting
headers that prevent this; don't change them without reading it.

### "Join code not found" or "That season is no longer active"

Codes belong to a season. Share the active season's current code from the admin
dashboard.

### Photo logging doesn't appear

AI features are off. Follow [Optional: AI photo reading](#optional-ai-photo-reading).

### Where to look for errors

- Browser developer console, for client errors.
- Firebase console → Functions → Logs, or Google Cloud **Logs Explorer**. Every callable
  logs a `callable_done` event; filter on `jsonPayload.fn`.
- The [Firebase backend reference](firebase-setup.md#logging--observability) explains the
  log fields, optional client log forwarding, and Sentry.

For anything else, ask in
[GitHub Discussions](https://github.com/dbruza/officefc/discussions).

## Optional: native apps

The web app covers everything except push notifications. Build native apps only if you
need push and are ready to look after an app-store listing. You need:

- an [Expo](https://expo.dev) account (EAS Build and Submit),
- for iOS, a paid Apple Developer Program membership,
- for Android, a Google Play Console account,
- a bundle identifier you own, for example `com.acme.officefc`. The same value is used as
  the iOS bundle ID and the Android package name.

### Configure EAS

`mobile/app.config.ts` reads the deployment-specific native settings from environment
variables:

| Variable                  | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `OFFICEFC_BUNDLE_ID`      | iOS bundle identifier and Android package              |
| `OFFICEFC_EAS_PROJECT_ID` | Your EAS project ID                                    |
| `OFFICEFC_EAS_OWNER`      | The Expo account or organisation that owns the project |
| `SENTRY_ORG`              | Optional, Sentry organisation for source-map uploads   |
| `SENTRY_PROJECT`          | Optional, Sentry project for source-map uploads        |

1. From `mobile/`, log in and create the EAS project:

   ```bash
   cd mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   Because the project ID comes from `app.config.ts` rather than `app.json`, `init` may
   print the ID for you to add instead of writing it. Either way, use that ID (also shown
   on the project's page at expo.dev) as `OFFICEFC_EAS_PROJECT_ID`.

2. Create EAS environment variables in each environment you build (`development`,
   `preview`, `production`): the three `OFFICEFC_*` values above, plus every
   `EXPO_PUBLIC_*` value from your `mobile/.env` except `EXPO_PUBLIC_USE_EMULATORS` and
   `EXPO_PUBLIC_SENTRY_ENV`, which `eas.json` sets per profile. They are public client
   values, so `plaintext` visibility is fine:

   ```bash
   npx eas-cli@latest env:create --environment production --visibility plaintext \
     --name OFFICEFC_BUNDLE_ID --value "com.acme.officefc"
   ```

   Set `EXPO_PUBLIC_WEB_URL` if you use a custom domain, so invite links shared from the
   apps point at it.

3. When you run `eas` commands locally, also export the three `OFFICEFC_*` variables in
   your shell, so the CLI resolves the same project and bundle ID as the cloud build.

Then build and submit:

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest build --platform android --profile production
npx eas-cli@latest submit --platform ios
```

`eas.json` carries no App Store Connect IDs; `eas submit` asks for them, or add your own
under `submit.production.ios` in your fork.

Source-map upload to Sentry is off in every profile (`SENTRY_DISABLE_AUTO_UPLOAD=true`). To
turn it on, set `SENTRY_ORG`, `SENTRY_PROJECT`, and a `SENTRY_AUTH_TOKEN` secret, and
remove that flag.

### Push notifications

Push needs APNs credentials for iOS (EAS offers to configure them during the first iOS
build) and Firebase Cloud Messaging V1 credentials plus `google-services.json` for
Android. [Real-device testing](real-device-testing.md) walks through both, along with
development builds on physical phones.

### Store requirements

Both stores review the app. OfficeFC already includes what they usually ask for:

- **Account deletion** inside the app (Settings → Delete account).
- **Privacy policy and support URLs**: use `https://<your-domain>/privacy`,
  `https://<your-domain>/support`, and `/terms`. Review them first (see
  [Legal pages](#legal-pages)).
- **Reporting and blocking** for user-generated content, with admin moderation in Admin →
  Safety. Store reviewers expect reports to be acted on promptly.
- **Explicit consent** before any photo goes to an AI model.

You also need a demo account for the reviewer (a verified member who has already joined),
App Privacy answers that match what your deployment collects, and a store listing that
doesn't use "FIFA" or "EA SPORTS FC" in the name, subtitle, or keywords. Apple's unlisted
app distribution, or Google Play's internal and closed testing tracks, suit a single
office. The original deployment's App Store checklist is kept as a reference in
[maintainers/app-store-submission.md](maintainers/app-store-submission.md).

## Configuration reference

### Cloud Functions parameters: `functions/.env.<projectId>`

Read at deploy time. `functions/.env`, if present, applies to every project and is
overridden by the project file. Both are gitignored. The local emulators use the committed
`functions/.env.demo-officefc`, overridden by a gitignored `functions/.env.local`.

| Parameter          | Default       | Purpose                                                    |
| ------------------ | ------------- | ---------------------------------------------------------- |
| `FUNCTIONS_REGION` | `us-central1` | Region for every function. Near your Firestore database.   |
| `ADMIN_EMAILS`     | empty         | Comma-separated emails that join as admins without a code. |
| `AI_FEATURES`      | `false`       | Deploy `extractMatchStats` and `analyzeMatch`.             |
| `SENTRY_DSN`       | empty         | Optional Sentry DSN for functions.                         |

### Secrets: Firebase Secret Manager

| Secret               | Needed when        | Set with                                                |
| -------------------- | ------------------ | ------------------------------------------------------- |
| `OPENROUTER_API_KEY` | `AI_FEATURES=true` | `npx firebase functions:secrets:set OPENROUTER_API_KEY` |

### App settings: `mobile/.env`

Native EAS builds take the same names from EAS environment variables.

| Variable                                   | Required    | Purpose                                                                             |
| ------------------------------------------ | ----------- | ----------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_FIREBASE_API_KEY`             | Yes         | Web app config from the Firebase console                                            |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Yes         | Web app config                                                                      |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID`          | Yes         | Web app config; must be the active Firebase project                                 |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Yes         | Web app config                                                                      |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes         | Web app config                                                                      |
| `EXPO_PUBLIC_FIREBASE_APP_ID`              | Yes         | Web app config                                                                      |
| `EXPO_PUBLIC_USE_EMULATORS`                | Yes         | `1` for the local emulators, `0` for anything deployed                              |
| `EXPO_PUBLIC_FUNCTIONS_REGION`             | No          | Default `us-central1`; must equal `FUNCTIONS_REGION`                                |
| `EXPO_PUBLIC_AI_FEATURES`                  | No          | `0`/`1`; must match `AI_FEATURES`. `0` hides AI features                            |
| `EXPO_PUBLIC_OPERATOR_NAME`                | Recommended | Who runs this deployment, named in the privacy policy and terms                     |
| `EXPO_PUBLIC_SUPPORT_EMAIL`                | Recommended | Contact shown on /privacy, /terms, and /support                                     |
| `EXPO_PUBLIC_DATA_LOCATION`                | Recommended | Where Firestore lives, as the privacy policy names it                               |
| `EXPO_PUBLIC_WEB_URL`                      | No          | Public URL for invite links from native apps; default `https://<projectId>.web.app` |
| `EXPO_PUBLIC_REMOTE_LOGGING`               | No          | `1` forwards client warnings and errors to Cloud Logging                            |
| `EXPO_PUBLIC_SENTRY_DSN`                   | No          | Sentry DSN for the app; empty keeps Sentry off                                      |
| `EXPO_PUBLIC_SENTRY_ENV`                   | No          | Sentry environment name                                                             |

`npm run validate:web-env` (also run by `build:web` and `deploy:backend`) checks that the
required values are present and look real, that the project ID matches the active Firebase
project, and that the region and AI settings agree with `functions/.env.<projectId>`.

### Native builds only: EAS environment variables

`OFFICEFC_BUNDLE_ID`, `OFFICEFC_EAS_PROJECT_ID`, `OFFICEFC_EAS_OWNER`, and optionally
`SENTRY_ORG` and `SENTRY_PROJECT`. See [Configure EAS](#configure-eas).

### Firebase project selection

`.firebaserc` (gitignored), written by `npx firebase use --add`. The deploy scripts
(`deploy:backend`, `deploy:web`, `deploy:mvp`) target the active project. The local
emulators and tests use the demo project ID `demo-officefc`, which never touches a real
project.
