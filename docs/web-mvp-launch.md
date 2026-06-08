# OfficeFC Web MVP Launch Runbook

Production URL: <https://officefc.bruza.tech>  
Firebase project: `office-fc`  
Firebase fallback URL: <https://office-fc.web.app>

The MVP is invite-only and uses email/password authentication. AI photo extraction is
assistive beta functionality: users must verify all values and opponents must confirm a
match before ELO changes.

## 1. Production prerequisites

From the repository root:

```bash
firebase login
firebase use office-fc
npm install
npm --prefix mobile install
npm --prefix functions install
```

Confirm `mobile/.env` contains the Firebase Web app config for `office-fc` and:

```dotenv
EXPO_PUBLIC_FIREBASE_PROJECT_ID=office-fc
EXPO_PUBLIC_USE_EMULATORS=0
```

The build fails before export if a required Firebase value is missing, the project ID is
wrong, or emulators are enabled.

## 2. Configure the Anthropic secret

Set or rotate the secret without putting it in `.env` or Git:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY --project office-fc
```

After rotation, redeploy Functions so new instances receive the latest secret:

```bash
npm run deploy:backend
```

## 3. Verify before deployment

```bash
npm test
npm --prefix functions test
npm run test:rules
npm --prefix mobile run typecheck
npm run build:web
npx --yes expo-doctor@latest mobile
```

Inspect `mobile/dist/index.html` and confirm the export completed without emulator URLs.

## 4. Deploy

Deploy everything required by the MVP:

```bash
npm run deploy:mvp
```

For later scoped releases:

```bash
npm run deploy:web       # validated web export + Hosting only
npm run deploy:backend   # Firestore, Storage, Functions, and scheduled jobs
```

First test <https://office-fc.web.app>. Check sign-in, a nested route refresh, a manual
match, and one photo extraction before connecting the custom domain.

## 5. Connect `officefc.bruza.tech`

1. Firebase Console -> Hosting -> Add custom domain.
2. Enter `officefc.bruza.tech`.
3. Copy the exact verification and routing records Firebase displays.
4. Add those TXT/CNAME/A records at the DNS provider for `bruza.tech`.
5. Remove only records Firebase explicitly identifies as conflicting.
6. Wait for Firebase to show the domain as connected and the TLS certificate as active.
7. Open <https://officefc.bruza.tech> and verify there is no certificate warning.

DNS and certificate provisioning can take several hours. Do not invent record values from
this document; Firebase's custom-domain wizard is the source of truth.

## 6. Authorize the domain

Firebase Console -> Authentication -> Settings -> Authorized domains:

- Add `officefc.bruza.tech`.
- Keep `office-fc.firebaseapp.com` and the existing Firebase-generated `authDomain`.
- Keep `localhost` for local development if it is already present.

Email/password is the only MVP provider, so no OAuth redirect-domain migration is needed.

## 7. Bootstrap the league

1. Sign up with `djbruza@gmail.com` and verify the email.
2. Complete the profile and join flow. The configured admin allowlist bootstraps this
   account as league admin without an invite code.
3. On Home, allow the app to create the initial active season and team catalogue if absent.
4. Review the season dates and active teams in Admin.
5. Generate a one-use member invite.
6. Create and verify a second account, redeem the invite, and complete its profile.
7. Do not reset existing production collections; setup functions merge missing seed data.

## 8. Production smoke test

Use two separate browser profiles or an incognito window.

- Sign-up, email verification, sign-in, password reset, sign-out, and invite redemption.
- Manual match submission appears immediately in the opponent's confirmation inbox.
- Confirm updates ELO, standings, profiles, H2H, and match detail.
- Dispute keeps the match out of ELO; admin resolution works.
- Mobile browser camera capture and library upload both normalize and upload.
- Desktop file upload accepts JPEG/PNG/WebP and safely rejects unreadable formats.
- AI extraction never auto-submits; edit extracted values before submission.
- Cancelling/replacing an upload removes the draft; stale unsubmitted drafts clear after 24 hours.
- Submitted photos open through temporary signed URLs and direct Storage reads remain denied.
- The submitter can delete a submitted photo.
- Refresh Home, confirmations, match detail, player, H2H, seasons, and archive URLs directly.
- Repeat critical paths in current iPhone Safari, Android Chrome, desktop Chrome, Safari, and Edge.

AI beta smoke set: use at least five readable full-time screens and two unreadable or
non-stats images. Every failure must offer manual entry and no image may auto-submit.

## 9. Rollback

Hosting:

1. Firebase Console -> Hosting -> Release history.
2. Select the last known-good release and choose Roll back.

Backend/rules:

1. Check out the last known-good Git revision in a clean worktree.
2. Run its tests.
3. Run `npm run deploy:backend`.

If a bad release affects data, disable the affected UI path first. Do not delete or reset
production data as a rollback mechanism.

## 10. Operational checks

- Firebase Console -> Functions: confirm `cleanupAbandonedDrafts` is scheduled daily and
  `sendReminders`/`weeklySnapshot` are healthy.
- Cloud Logging: monitor extraction failures, rate limits, and scheduled cleanup errors.
- Firebase Usage and billing: set budget alerts for the project.
- Rotate `ANTHROPIC_API_KEY` immediately if exposed, then redeploy Functions.
- Keep native/EAS configuration buildable, but do not include App Store or Play Store work
  in the web MVP release.
