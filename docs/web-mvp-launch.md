# Web release runbook

A checklist for shipping a web release to a deployment that is already set up: verify,
deploy, smoke-test, and roll back if needed. For a first-time setup, follow the
[self-hosting guide](self-hosting.md).

In the examples, `https://<your-domain>` is your web app's address: your custom domain, or
`https://<your-project-id>.web.app`.

The league is invite-only and uses email/password authentication. AI photo reading, when
enabled, is assistive: players check every value, and opponents must confirm a match before
ELO changes.

## 1. Prerequisites

From the repository root:

```bash
npx firebase login
npx firebase use              # confirm the active project is the one you mean to deploy
npm ci
npm --prefix mobile ci
npm --prefix functions ci
npm --prefix test/rules ci
```

Confirm `mobile/.env` holds the Firebase web app config for that project, with
`EXPO_PUBLIC_USE_EMULATORS=0`. Compare it with `mobile/.env.example` for settings added
since your last release.

The build stops before exporting if a required Firebase value is missing or looks like a
placeholder, the project ID isn't the active project, emulators are enabled, or the region
and AI settings disagree with `functions/.env.<projectId>`.

## 2. Secrets

Only needed with `AI_FEATURES=true`. Set or rotate the OpenRouter key without putting it in
`.env` or Git:

```bash
npx firebase functions:secrets:set OPENROUTER_API_KEY
```

After a rotation, redeploy the backend so new instances receive the latest secret:

```bash
npm run deploy:backend
```

## 3. Verify before deploying

```bash
npm run check
npx --yes expo-doctor@latest mobile
```

Inspect `mobile/dist/index.html` and confirm the export completed without emulator URLs.

## 4. Deploy

Deploy everything:

```bash
npm run deploy:mvp
```

Or in scoped steps:

```bash
npm run deploy:backend   # Firestore rules and indexes, Storage rules, Functions, scheduled jobs
npm run deploy:web       # validated web export + Hosting only
```

When a release adds Firestore indexes, deploy the backend first and wait for the indexes to
finish building before deploying the web app.

Test `https://<your-project-id>.web.app` first: sign in, refresh a nested route, log a
manual match, and (with AI on) read one photo.

### Hosting cache invariants

Two `firebase.json` hosting rules exist to stop a deploy from white-screening returning
visitors. Both are easy to break by "simplifying" the config, so re-check them after any
edit. The hosting emulator (`npx firebase emulators:start --only hosting --project
demo-officefc`) reproduces the production matcher exactly:

1. **Every HTML response must be uncacheable.** The no-store rule is `"source": "**"`, not
   `"source": "/index.html"`. Header globs are matched against the _requested_ path, not
   the rewrite destination, so a rule scoped to `/index.html` never fires for `/` or for
   any deep route, and those are the only paths real users request. A cached `index.html`
   points at the previous release's bundle hash, which no longer exists.
2. **The SPA rewrite must never cover `/_expo/**` or `/assets/**`.** A catch-all
   `"source": "**"` rewrite answers a request for a missing hashed bundle with
   `index.html` at HTTP 200 and `Content-Type: text/html`. The browser parses that as
   JavaScript, throws `Unexpected token '<'`, and renders nothing. Because those paths
   also carry `max-age=31536000, immutable`, it caches the broken response for a year, so
   reloading never recovers. Excluding the two asset roots turns that case into a clean
   404 instead.

Verify after deploying:

```bash
curl -sI https://<your-domain>/ | grep -i cache-control
# expect: no-cache, no-store, must-revalidate

curl -sI https://<your-domain>/_expo/static/js/web/entry-doesnotexist.js | head -1
# expect: HTTP/2 404, NOT 200
```

A visitor already stuck on a white screen from an earlier release recovers on a
cache-bypassing reload (Ctrl/Cmd+Shift+R) or by clearing site data; a normal reload will
not clear a poisoned immutable entry.

## 5. Custom domain

Connecting a domain and authorizing it for sign-in is covered in
[Optional: custom domain](self-hosting.md#optional-custom-domain). Firebase's
custom-domain wizard is the source of truth for DNS records; don't copy record values from
any document.

## 6. Smoke test

Use two separate browser profiles or an incognito window.

- Sign-up, email verification, sign-in, password reset, sign-out, and joining with an
  invite link.
- Manual match submission appears immediately in the opponent's confirmation inbox.
- Confirming updates ELO, standings, profiles, head-to-head, and match detail.
- A dispute keeps the match out of ELO; admin resolution works.
- Refresh Home, confirmations, match detail, player, head-to-head, seasons, and archive
  URLs directly.
- `/privacy`, `/terms`, and `/support` load signed out and show your operator name and
  support email.
- Repeat the critical paths in current iPhone Safari, Android Chrome, desktop Chrome,
  Safari, and Edge.

With AI photo reading on, also check:

- Mobile browser camera capture and library upload both normalize and upload.
- Desktop file upload accepts JPEG/PNG/WebP and safely rejects unreadable formats.
- Extraction never auto-submits; edit extracted values before submission.
- Cancelling or replacing an upload removes the draft; stale unsubmitted drafts clear after
  24 hours.
- Submitted photos open through temporary signed URLs, and direct Storage reads stay
  denied.
- The submitter can delete a submitted photo.
- Use at least five readable full-time screens and two unreadable or non-stats images.
  Every failure must offer manual entry, and no image may auto-submit.

## 7. Rollback

Hosting:

1. Firebase console → Hosting → Release history.
2. Select the last known-good release and choose Roll back.

Backend and rules:

1. Check out the last known-good Git revision in a clean worktree.
2. Run its tests.
3. Run `npm run deploy:backend`.

If a bad release affects data, disable the affected UI path first. Do not delete or reset
production data as a rollback mechanism.

## 8. Operational checks

- Firebase console → Functions: confirm the scheduled jobs (`sendReminders`,
  `autoConfirmStaleMatches`, `weeklySnapshot`, `cleanupAbandonedDrafts`,
  `retryNotifications`, `recoverQueuedModels`) are deployed and healthy.
- Cloud Logging: monitor callable failures, extraction failures, rate limits, and
  scheduled-job errors. The [Firebase backend reference](firebase-setup.md) explains the
  log fields.
- Sentry, if configured: watch the app and functions projects for new issues. Without a
  DSN, Sentry is off and a `sentry_disabled` warning appears in Cloud Logging.
- Billing: keep a budget alert on the project.
- Rotate `OPENROUTER_API_KEY` immediately if it is exposed, then redeploy the backend.
