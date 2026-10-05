# App Store submission (unlisted distribution)

How OfficeFC goes from TestFlight to an unlisted App Store app that coworkers install from a
link. Unlisted apps still go through full App Review; they just don't appear in search,
charts or categories.

Apple's references: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution/).

## 1. Before you build

- [ ] **Support inbox.** Create the dedicated support address, then set `SUPPORT_EMAIL` in
      `mobile/src/lib/constants.ts` (it's a placeholder, `officefc-support@example.com`). It
      shows on the privacy policy, terms, support page and in App Store Connect.
- [ ] **Review the legal copy** in `mobile/src/lib/legal.ts` (privacy policy, terms, support).
      Bump `LEGAL_UPDATED` if you change it.
- [ ] **Merge** the release to `main` the usual way (feature PR into `development`, release PR
      into `main`).

## 2. Deploy, in this order

1. `npm run deploy:backend`: Firestore/Storage rules and every function. New functions:
   `deleteAccount`, `reportPlayer`, `setPlayerBlocked`, `resolveReport`, `moderateMember`, and
   the `screenProfileName` trigger.
2. `npm run deploy:web`: puts the app at office-fc.web.app, including the public `/privacy`,
   `/terms` and `/support` pages. App Store Connect links to these.
3. `cd mobile && eas build --platform ios --profile production --auto-submit`: a store
   build goes to App Store Connect / TestFlight. The native code didn't change, but the
   binary needs the new JS bundle.

> **Heads-up for current TestFlight users (1.11.1):** once the backend is deployed, photo
> logging on old builds is refused until the user allows AI photo reading. Old builds have
> no switch for it, so they'll see "update the app, or log the match manually". Allowing it
> once on the web (Settings → Privacy & safety) also fixes it for their old build, because
> the choice is stored per account. Manual logging is unaffected.

## 3. Demo account for App Review

The reviewer can't get past email verification and the join code alone, so give them a
ready account:

- [ ] Sign up on office-fc.web.app with an inbox you control (e.g. `appreview@…`), verify
      the email, set a profile (e.g. "App Reviewer"), and join with the current season code.
      Keep it a **member, not an admin**.
- [ ] Optionally log a match or two against a willing colleague so the account isn't empty.
- [ ] The reviewer will see real league members' names and results. Give the league a
      heads-up.

## 4. App Store Connect: app information

| Field | Value |
|---|---|
| Name | OfficeFC |
| Subtitle | Your office football league (no "FIFA"/"EA SPORTS FC" anywhere in name, subtitle or keywords) |
| Category | Sports |
| Privacy Policy URL | https://office-fc.web.app/privacy |
| Support URL | https://office-fc.web.app/support |
| Age rating | Answer the questionnaire honestly. There's user-generated content (names, photos, dispute text) shared only within a private league; no chat, no web browsing, no ads, no gambling. |
| Content rights | The app shows football club names and photos of game stats screens. Answer "Does your app contain third-party content?" yourself. That's your call. |
| Screenshots | iPhone 6.9" set (e.g. 1320 × 2868). No iPad set needed (`supportsTablet` is false). Don't show the EA game screen in screenshots. |
| Distribution | Choose **Manually release this version**, so nothing goes live before you're ready. |

Keywords idea: `league,office,football,soccer,elo,ranking,tournament,work,colleagues,scores`.

## 5. App Privacy ("nutrition label")

Nothing is used for tracking, so you don't need the App Tracking Transparency prompt.

| Data type | Collected | Linked to user | Purpose |
|---|---|---|---|
| Contact info → Email address | Yes | Yes | App functionality (sign-in) |
| Contact info → Name | Yes (display name) | Yes | App functionality |
| Identifiers → User ID | Yes | Yes | App functionality, analytics (diagnostics) |
| User content → Photos | Yes (stats-screen photos) | Yes | App functionality |
| User content → Other user content | Yes (results, dispute reasons, reports) | Yes | App functionality |
| Usage data → Product interaction | No | | |
| Diagnostics → Crash data | Yes (Sentry) | Yes (anonymous uid) | App functionality |
| Diagnostics → Performance data | Yes (Sentry traces) | Yes | App functionality |
| Diagnostics → Other diagnostic data | Yes (app logs) | Yes | App functionality |

## 6. App Review notes (paste into "Notes")

```
OfficeFC is a private league tracker for colleagues who play EA SPORTS FC together at our
office: players log results, confirm each other's scores, and follow ELO ratings and a
finals bracket. It is intended for a limited audience (our workplace) and we are requesting
UNLISTED distribution; the request form has been / will be submitted.

Demo account (member of our real league, email verified, already joined):
  Email: <appreview@…>
  Password: <…>
New accounts need a join code from a league admin; the demo account already has one.

Where to find required features:
- Account deletion: Settings (gear icon on the You tab) → Privacy & safety → Delete account.
- Report / block a player: open any player's profile → shield icon (top right).
  A match photo can also be reported from the match screen.
- Terms (zero tolerance for objectionable content) and Privacy Policy: Settings → About,
  and required at sign-up. Admins act on every report within 24 hours.
- AI photo reading: "Log match" → "Upload match photo" asks for explicit permission
  before any photo is sent to the third-party AI model (OpenRouter → Meta Muse Spark).
  Logging manually is always available.

OfficeFC is not affiliated with Electronic Arts, EA SPORTS or FIFA.
```

## 7. Unlisted distribution request

1. Submit the build for review with the notes above.
2. Submit the [unlisted app request form](https://developer.apple.com/contact/request/unlisted-app/)
   (Apple declines requests for apps that haven't been submitted for review, or that are in
   beta). Suggested answers:
   - **Who is the app for?** Employees at our workplace who play in the office EA SPORTS FC
     league (about _N_ people).
   - **How will users get it?** We'll share the App Store link internally (Slack/email).
   - **Why unlisted?** The app only works with a join code for our private league. It's an
     internal employee resource, not something the general public can use.
3. Once Apple approves both, release the version and share the link App Store Connect gives
   you.

## 8. Ongoing obligations

- **Reports within 24 hours.** Every report and block pushes the admins. Handle them in
  Admin → Safety (replace name, remove player, dismiss). The terms promise a 24-hour response,
  and Apple expects it.
- Keep the privacy policy in step with what the app collects. Any new third-party service or
  AI feature needs a policy update, and if it involves personal data and AI, an explicit
  opt-in.
- Open cup or finals ties involving a removed or deleted player can't be played. Settle them
  with a walkover (finals) or force-advance (cup).
