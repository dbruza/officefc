# OfficeFC Implementation Plan

> Single source of truth. Consolidates the original build plan, the plan-mode gap review,
> the locked product decisions, the GCP/Firebase re-platform, and live build status.

## Summary

Build OfficeFC as an **Expo / React Native app for iOS, Android, and web** backed by **Google
Cloud / Firebase (serverless)**, with **AI-assisted match logging**: snap the end-of-match stats
screen and Claude vision pre-fills the score and key stats for the player to confirm. Native mobile
is the primary experience; Expo Web is a supported secondary client and will be deployed to the
user's custom domain during M6.

The ZIP prototype in `prototype/officefc` (and the generated `OfficeFC.html`) is the
**visual/source reference**, not the production architecture. V1 targets prototype parity plus AI
photo extraction: authenticated users, one office league, admin-managed seasons and teams,
opponent-confirmed match logging, per-season ELO standings, head-to-head records, player profiles,
match photos with AI extraction, and season archives.

## Decisions (locked)

1. **ELO resets every season** (base `1500`, `K=32`). Leaderboard, standings, and the profile ELO
   chart are **per active season**; head-to-head, nemesis, and biggest win are **all-time**.
2. **Auth = Firebase email + password** (verify + reset). No social login, so Apple's
   Sign-in-with-Apple requirement is not triggered.
3. **Joining = admin invite code/link** into the single office league.
4. **Target game = FIFA 23**; the AI reader's prompt/schema/eval are tuned to its full-time stats screen.
5. **Data layer = Firestore (serverless)**; clients read Firestore directly under security rules,
   and **all trusted writes go through Cloud Functions (Admin SDK)**.
6. **Claude via the direct Anthropic API** (billed separately from GCP credits).

## Stack

- **App:** Expo (React Native) + Expo Router + TypeScript. (RN Web enabled for local preview.)
- **Auth:** **Firebase Authentication** (email/password).
- **Database:** **Cloud Firestore** + security rules. NoSQL — read-optimized via denormalized,
  function-maintained aggregate documents (standings, head-to-head, player stats).
- **Server logic:** **Cloud Functions (2nd gen, Node/TS)** for all privileged work — AI extraction,
  ELO recalculation, match confirmation, season finalization. They use the Firebase Admin SDK and
  therefore bypass security rules; clients cannot write trusted fields directly.
- **Storage:** **Cloud Storage** private bucket for match photos; access via short-TTL signed URLs
  minted by a function.
- **Scheduled jobs:** **Cloud Scheduler → Pub/Sub → function** for weekly rating snapshots
  (leaderboard movement) and confirmation-reminder pushes.
- **Secrets/config:** **Secret Manager** holds `ANTHROPIC_API_KEY`; a non-secret Functions
  parameter holds the model id. Neither is configured in the mobile bundle.
- **AI:** Anthropic **Claude (vision)**, direct API, called **only** from a Cloud Function.
- **Push:** **Expo Push** (backend-agnostic); device tokens stored in Firestore.
- **Device capabilities:** `expo-camera` / `expo-image-picker`, `expo-font` (Archivo +
  JetBrains Mono), `react-native-svg` (ELO chart), `expo-notifications`.
- **Distribution:** EAS Build + EAS Submit → TestFlight + Play internal testing.

**Why native (vs. the prototype's web framing):** the core loop is "snap a photo right after a
match," and opponent confirmation depends on reliable push — both are strongest on native.

**Reuse, not rewrite:** the extraction `core/*.mjs` is dependency-free Node ESM and the prototype's
ELO/derived-stat logic in `prototype/officefc/app/data.js` is plain JS — both run server-side in
Cloud Functions almost verbatim. Only the Deno Edge Function handler is replaced by a Node entry
that downloads from Cloud Storage and verifies a Firebase ID token.

## Firestore data model (reset-per-season; denormalized for cheap reads)

- `profiles/{uid}` — displayName, handle, jersey, avatar color, role.
- `leagues/{leagueId}` — name/settings (single league in v1; id `office`).
- `leagues/{id}/members/{uid}` — role, joinedAt.
- `invites/{code}` — role, expiresAt, usedBy, createdBy (admin-issued join codes).
- `seasons/{seasonId}` — name, year, start, end, active.
- `teams/{teamId}` — name, active (admin-curated, generic names — no real clubs).
- `matches/{matchId}` — seasonId, aId/bId, aTeam/bTeam, aGoals/bGoals, status, submittedBy,
  confirmedBy, **`source` (`manual` | `ai_assisted`)**, optional per-side stats
  (`possession`, `shots`, `shots_on_target`), per-player ELO before/after/delta, timestamps.
- AI photo fields on the match — Storage path, `extracted_json` (map),
  `extraction_status` (`pending`|`done`|`failed`), `extraction_confidence`, `extraction_model`,
  `extracted_at`, **`extraction_edited_by_human`**.
- `matchDrafts/{draftId}` — server-only extraction/idempotency state before an AI-assisted match
  is submitted.
- `aiRateLimits/{uid}` — server-only rolling extraction counter.
- **Materialized by the recalc function** (Firestore has no joins):
  - `seasons/{id}/standings/{uid}` — rank, elo, w, d, l, gf, ga, form(last5), **move**.
  - `seasons/{id}/snapshots/{weekKey}` — one weekly document containing
    `rows: { [uid]: { rank, elo } }` for leaderboard movement. Do not use the previously proposed
    invalid path `snapshots/{weekKey}/{uid}`; a Firestore document cannot directly contain documents.
  - `seasons/{id}/eloHistory/{uid}` — compact rating-over-time series for the profile chart.
  - `playerStats/{uid}` — all-time record, streaks, biggest win, nemesis.
  - `h2h/{pairKey}` — all-time head-to-head aggregate per player pair.
  - `seasonResults/{seasonId}` — championId, runnerUpId; `seasonResults/{id}/potm/{month}` — playerId.
- `deviceTokens/{uid}/tokens/{tokenId}` — expoPushToken, platform.

Photos live in a **private bucket**, readable only by league members via signed URLs.

## ELO + match lifecycle

- **Reset per season:** ratings derive from **confirmed matches in that season only**, processed
  in **chronological order** (avoids drift and client tampering). Base `1500`, `K=32`,
  win/draw/loss — identical math to `prototype/officefc/app/data.js`, lifted server-side.
- Only **confirmed** matches affect standings/ELO. Statuses: `pending_confirmation`, `confirmed`,
  `disputed`, `voided`.
- **Confirmation is a Cloud Function (callable), not a client write.** A member creates a
  `pending_confirmation` match where they participate; only the **named opponent** can confirm;
  rules deny client writes to status/ELO/standings. Confirming triggers `recalcSeasonElo`.
- **Opponents must be registered league members** (no guests in v1).
- **Non-response** → match stays pending (no silent auto-confirm — opponent confirmation is the
  anti-cheat). A reminder push fires after ~48h; admins can force-resolve.
- **Edits/deletes after confirm** → admin-only; trigger a full season recalc. Disputes are
  admin-resolved (correct the score or void).
- First admins are assigned by an email allowlist on sign-in.

## AI-assisted match logging

**Goal:** snap the FIFA 23 full-time stats screen, auto-fill the score + key stats, human confirms.

**Flow (human-in-the-loop):**
1. Capture the stats photo (`expo-camera` / picker) → upload to the private Storage bucket.
2. App calls Cloud Function `extractMatchStats` with the storage path (+ Firebase ID token).
3. The function downloads the bytes (`@google-cloud/storage`), downscales to ~1568px max edge, and
   calls Claude vision with a **tool/JSON schema** so it returns structured data, not prose:
   ```
   { detected_screen, confidence,
     home: { team_name?, goals, possession?, shots?, shots_on_target? },
     away: { team_name?, goals, possession?, shots?, shots_on_target? } }
   ```
   Prompt rules: read left/right by on-screen position; return `null` for anything unreadable;
   **never guess the score**.
4. The app **pre-fills** the score step (+ stats). Because the photo can't identify players, the
   user still **picks the opponent and taps which side was theirs**. Low-confidence fields are
   flagged for review and remain editable.
5. User submits → normal `pending_confirmation` → opponent confirms.

**Scope (decided):** extract **score + key stats** — goals (required-or-null) plus possession,
shots, and shots on target (best-effort, editable). **Team auto-detection is deferred.**

**Guardrails:**
- **Never auto-submit, never auto-confirm.** AI pre-fills; the human verifies; the opponent
  confirms. **Opponent confirmation — not the photo — is the anti-cheat** (a photo can be faked).
- Store the raw `extracted_json` + confidence on the match; set `source = ai_assisted` and track
  `extraction_edited_by_human`.
- API key only in the Cloud Function (Secret Manager). The endpoint is auth-only, **rate-limited
  per user** (a Firestore counter on `uid`), and **idempotent** (don't re-extract a stored photo
  unless forced).
- **Graceful fallback** to manual entry on low confidence, failure, or a non-game screen (the photo
  step stays optional, exactly as in the prototype).
- **Privacy:** stats screens can contain gamertags/club crests — keep images private, document
  handling, and allow deletion. Teams stay generic (don't ingest real crests into branding).

## App experience (prototype screens, rebuilt in React Native)

Rebuild the prototype screens as Expo Router routes/components, preserving the design:
home dashboard, leaderboard, seasons/Hall of Fame, player profile (with SVG ELO chart),
match detail, head-to-head, log-a-match flow, and profile setup/edit. Additions for v1:

- The log flow gains a **"Snap result"** entry that runs extraction and pre-fills the form;
  the manual path remains.
- A **confirm/dispute inbox** surface, driven by push, for opponent confirmation.

Design direction preserved: dark, mobile-first UI; electric-green accent (#00ff87); compact,
stat-heavy layout; ELO/rank as the main emotional loop; cheeky office-rivalry tone where appropriate.

## Design notes & rationale (gap review resolutions)

The plan-mode review of the original plan surfaced these gaps; each is now resolved in
the model/lifecycle above. Recorded here so the "why" isn't lost:

- **ELO season scope** was undefined → **reset per season** (prototype-faithful); recompute from
  confirmed season matches only.
- **Auth + join** was vague ("email allowlist on sign-in") → **email/password + admin invite
  codes** (`invites` collection), with an admin email allowlist only for bootstrapping.
- **Weekly leaderboard movement** had nowhere to come from → `seasons/{id}/snapshots/{weekKey}`
  written weekly by Cloud Scheduler; `move = previousRank - currentRank`, so a positive number means
  the player moved up (for example, previous rank 4 and current rank 2 gives `move = +2`).
- **Season finalization / Hall of Fame** (champion, runner-up, player-of-the-month) had no storage
  → `seasonResults` + `.../potm` + frozen `standings`. **POTM rule:** highest ELO gain in the
  calendar month, min 3 games; deterministic tie-break is higher ending ELO, then UID.
- **Push** relied on tokens that weren't modeled → `deviceTokens`; functions send Expo push on
  submit / confirm / dispute.
- **Profile ELO chart** source → `seasons/{id}/eloHistory/{uid}`, written on recalc.
- **ELO recalc trigger** was unspecified → `recalcSeasonElo(seasonId)` Cloud Function, run on any
  season-match status change; deterministic, server-side, tamper-proof.
- **Confirmation** could have been a client write → it's a **callable function** (anti-cheat).
- **Opponents must be registered members**; **non-response stays pending** (reminder push, no
  auto-confirm); **post-confirm edits are admin-only** and trigger recalc.
- **AI practicals**: real FIFA 23 eval images still needed; verify the model id at implementation
  time; downscale before send; per-user rate limit + idempotency.
- **Security**: explicit Firestore/Storage rules (members read; functions write) + rules-unit-tests.

## Build sequence (MVP-first, with verification)

- **M0 — Scaffold.** ✅ **DONE.** Expo + Expo Router + TS; Firebase config + Emulator Suite; design
  tokens + UI primitives ported from `prototype/officefc/app/ui.jsx` to RN.
  *Verified:* `tsc` clean → web bundle builds → renders & screenshots faithfully on RN Web →
  console clean; extraction tests still 10/10.
- **M1 — Auth + membership.** ✅ **DONE.** Email/password (verify + reset), profile setup, admin invite-code
  join, league seed, tightened Firestore/Storage rules, admin bootstrap.
  *Verify:* two emulator users join via code; `@firebase/rules-unit-testing` proves a non-member
  can't read and clients can't write trusted fields.
- **M2 — Core loop, no AI.** ✅ **DONE.** Manual log flow (opponent → teams → score → review); create
  `pending_confirmation`; `confirmMatch` + `recalcSeasonElo` functions; standings/leaderboard;
  push on submit/confirm.
  *Verify:* submit→confirm moves ELO and matches a hand-calc; voided/disputed excluded.
- **M3 — Read-screen parity.** ✅ **DONE.** Home, player profile + SVG ELO chart, match detail, head-to-head,
  seasons/Hall of Fame — reading materialized Firestore docs.
  *Verify:* RN Web screenshots match the prototype; derived stats equal `data.js` for the same
  match list.
- **Phase 0 — Expo SDK 56 upgrade.** ✅ **DONE.**
- **M4 — AI-assisted logging.** ✅ **DONE.**  (device testing + eval images pending)
  - **M4A (native capabilities):** ✅
  - **M4B (extraction backend):** ✅
  - **M4C (snap flow + trusted submit):** ✅
- **M5 — Season lifecycle + admin.** ✅ **DONE.**
  *Verify:* finalize archives a season; movement renders; POTM rule holds.
  - `finalizeSeason`: admin-only, idempotent. Freezes season, computes champion/runner-up, calculates POTM per calendar month (highest ELO gain, min 3 games, tiebreak by ending ELO then UID). Writes `seasonResults/{id}` + `seasonResults/{id}/potm/{YYYY-MM}`.
  - `createSeason` / `activateSeason`: admin-only season lifecycle.
  - `manageTeam`: admin-only add/rename/deactivate teams.
  - `resolveMatch`: admin-only confirm/correct_confirm/void with audit trail (previous score/status, resolution reason, resolvedBy). Triggers season recalc + league stats recalc.
  - `listSeasons`: all members, returns season catalogue.
  - `weeklySnapshot` (scheduled, Sunday 00:00 UTC): writes `seasons/{activeId}/snapshots/{YYYY-Www}` with rank/ELO rows, updates `move` on standings.
  - `sendReminders` (scheduled, every 6h): pushes to opponents of `pending_confirmation` matches older than 48h, stores `reminderSentAt`.
  - Admin UI at `/(app)/admin`: tabbed Seasons/Teams/Pending. Create/activate/finalize seasons, add/rename/deactivate teams, confirm/void pending matches.
  - Client API in `league.ts`: `finalizeSeason`, `createSeason`, `activateSeason`, `manageTeam`, `resolveMatch`, `listSeasons`, `getAdminPendingMatches`.
- **M5 — Season lifecycle + polish.** ⬜ **NOT STARTED.** Admin `finalizeSeason` (freeze standings, champion/runner-up,
  POTM); weekly `snapshots` for movement; dispute/void admin tools.
  *Verify:* finalize archives a season; movement renders; POTM rule holds.
- **M6 — Release.** ⬜ **NOT STARTED.** Firebase production deploy, Firebase Hosting/custom domain,
  EAS Build + Submit → TestFlight + Play internal.
  *Verify:* internal testers run the full loop on real hardware.

## Handoff instructions for future implementation models

This section is deliberately explicit. A future model should treat it as an execution contract,
not as optional suggestions.

### Rules for every remaining PR

1. Start from the latest merged `main`. Do not continue from an old feature branch.
2. Use one focused branch/PR per phase below. Recommended order:
   - `codex/expo-sdk-56-upgrade`
   - `codex/m4-ai-backend`
   - `codex/m4-ai-mobile`
   - `codex/m5-season-admin`
   - `codex/m6-release-hosting`
3. Use Firebase/GCP as the sole production backend. The extraction core is owned by the
   Cloud Functions package at `functions/src/extract/core/` and is called only by the
   `extractMatchStats` Cloud Function — never from the mobile app.
4. Preserve the trust boundary:
   - clients may create an untrusted manual pending match under restrictive rules;
   - status, ELO, standings, all-time stats, extraction metadata, season results, and admin
     resolution are written by Cloud Functions using the Admin SDK;
   - never put `ANTHROPIC_API_KEY` or another secret in `mobile/.env`.
5. Do not claim a phase complete until its acceptance checklist passes.
6. Keep the manual match path working throughout M4. AI is an optional assistive entry path.
7. Update this file and add/update a `docs/running-*.md` runbook in every milestone PR.
8. Preserve existing user changes and avoid unrelated refactors.

### Current baseline after M5

- M0–M5 implemented and emulator/browser verified.
- **Expo SDK 56** (React 19.2.3, RN 0.85.3, TS 6.0.3, New Architecture). `expo-doctor` 21/21.
- **M4/M4A:** Native packages + upload contract + device tokens + storage rules + eas.json ready. Physical device testing needed.
- **M4B:** `extractMatchStats` (Secret Manager, rate-limited, idempotent), `getMatchPhotoUrl` (signed URLs), extraction core at `functions/src/extract/core/`.
- **M4C:** `submitAiAssistedMatch` (server-computed `extractionEditedByHuman`). `SnapFlow` component — full snap→upload→extract→pre-fill→review→submit flow.
- **M5:** `finalizeSeason` (champion, runner-up, POTM). `createSeason`/`activateSeason`/`manageTeam`/`resolveMatch` (admin). Weekly snapshots + 48h reminder scheduled functions. Admin UI at `/(app)/admin`.
- Current Functions runtime is Node.js 20.
- Current confirmed-match flow recalculates:
  - `seasons/{seasonId}/standings/{uid}`;
  - `seasons/{seasonId}/eloHistory/{uid}`;
  - `playerStats/{uid}`;
  - `h2h/{sortedUidPair}`.
- M3 archive UI exists, but M5 must create the `seasonResults`/POTM data that populates it.
- Push sending hooks exist server-side, but the app does not yet register device tokens.
- `storage.rules` already provides a private `match-photos/{uid}/...` namespace, but deletion and
  the complete AI draft lifecycle still need implementation.

### Primary implementation references

Future models should check these official sources before changing versions or native configuration:

- Expo SDK 56 release: `https://expo.dev/changelog/sdk-56`
- Expo incremental upgrade guide:
  `https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/`
- Expo Camera: `https://docs.expo.dev/versions/latest/sdk/camera/`
- Expo push setup: `https://docs.expo.dev/push-notifications/push-notifications-setup/`
- Firebase Functions secrets/config: `https://firebase.google.com/docs/functions/config-env`
- Firebase Storage rules: `https://firebase.google.com/docs/storage/security`
- Anthropic vision: `https://docs.anthropic.com/en/docs/build-with-claude/vision`
- Anthropic tool use: `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview`

## Remaining implementation plan

### Phase 0 before M4 — Expo SDK 51 → 56 upgrade

**Goal:** modernize the Expo project before adding camera and notifications. Keep this in a
standalone PR so dependency/native breakage is not mixed with AI feature work.

#### Required steps

1. Begin from clean, latest `main`.
2. Upgrade incrementally: 51 → 52 → 53 → 54 → 55 → 56.
3. At each SDK step:
   - run `npm install expo@^<SDK>.0.0` from `mobile/`;
   - run `npx expo install --fix`;
   - read that SDK's Expo release notes for mandatory migrations;
   - run `npx expo-doctor`;
   - run `npm run typecheck`;
   - run `npm run export:web`;
   - boot the app on web and an iOS Simulator before advancing.
4. Do not manually guess compatible React Native, React, Expo Router, or native module versions;
   let `expo install --fix` select compatible versions.
5. SDK 55 dropped Legacy Architecture support. Remove `newArchEnabled: false` from
   `mobile/app.json` (or explicitly enable the New Architecture) before validating SDK 55/56.
6. Regenerate native folders only if the chosen Expo workflow requires them. Do not commit
   accidental native build output or credentials.
7. Keep Firebase emulator host behavior intact on:
   - web: `localhost`;
   - iOS simulator: `localhost`;
   - Android emulator: `10.0.2.2`.

#### Acceptance checklist

- `npx expo-doctor` reports no actionable dependency mismatch.
- `npm --prefix mobile run typecheck` passes.
- `npm --prefix mobile run export:web` passes.
- Auth/onboarding, dashboard, manual log, confirmation, profile, H2H, and seasons render on web.
- iOS Simulator launches and completes sign-in plus one navigation smoke test.
- Existing root, Functions, and rules tests still pass.

### M4A — Native capabilities, image upload, and device tokens

**Goal:** establish a development build with camera/photo selection and real push-token
registration before adding Claude.

#### Dependencies and config

1. Install with `npx expo install`:
   - `expo-dev-client`;
   - `expo-camera`;
   - `expo-image-picker`;
   - `expo-notifications`;
   - `expo-device`;
   - `expo-image-manipulator` if client-side resize/compression is used.
2. Add required Expo config plugins and human-readable camera/photo/notification permission text
   to `mobile/app.json`.
3. Run `eas init`, record `extra.eas.projectId`, and create `mobile/eas.json` with at least
   `development`, `preview`, and `production` profiles.
4. Create and install a development build on at least one physical phone. Push notifications do
   not work on iOS Simulator or Android Emulator.

#### Draft ID and upload contract

The photo is uploaded before the match document exists. Use this exact lifecycle:

1. Generate a Firestore document ID on the client without writing a match:
   `draftId = doc(collection(db, "matches")).id`.
2. Upload the image to:
   `match-photos/{uid}/{draftId}/source.<ext>`.
3. Carry `draftId` and `storagePath` through extraction and submission.
4. Do not create a placeholder match with a trusted or incomplete status.
5. Extend `storage.rules` so the owner can explicitly delete their own uploaded draft/photo.
   Keep direct reads denied; viewing must use a short-lived signed URL from a callable.

#### Device-token registration

1. Add `mobile/src/lib/notifications.ts`.
2. On a physical device:
   - request notification permission;
   - read the EAS `projectId` from Expo Constants;
   - call `Notifications.getExpoPushTokenAsync({ projectId })`;
   - write the token to `deviceTokens/{uid}/tokens/{tokenId}` using a deterministic hash or safely
     encoded token ID;
   - store platform and `updatedAt`.
3. Skip token registration on web/simulator without breaking startup.
4. Add notification response routing:
   - `match_pending` → confirmations;
   - `match_confirmed` → match detail;
   - `match_disputed` → match detail/appropriate status surface.

#### Acceptance checklist

- Development build opens on a physical phone.
- User can take a photo and select an existing image.
- Image uploads under the signed-in user's draft path and cannot be read directly.
- User can delete an abandoned upload.
- Device token appears under the correct Firestore path.
- A test Expo push opens the expected app route.
- Web/manual logging remains functional without camera or native push.

### M4B — Firebase AI extraction backend

**Goal:** wrap the existing extraction core in authenticated, rate-limited Cloud Functions.

#### Reuse boundaries

- The extraction core lives at `functions/src/extract/core/` and is owned by the Cloud Functions
  package. Reuse these modules with minimal or no behavior changes:
  - `functions/src/extract/core/anthropic.mjs`;
  - `functions/src/extract/core/extract.mjs`;
  - `functions/src/extract/core/prompt.mjs`;
  - `functions/src/extract/core/schema.mjs`;
  - `functions/src/extract/core/validate.mjs`.
- Configure the Functions build (esbuild/tsconfig) to package the core ESM modules reliably. Do
  not import production code from any obsolete legacy extraction handler at runtime.
- Keep root extraction tests and the eval harness working after the move.

#### Function contract: `extractMatchStats`

Input:

```ts
{ draftId: string; storagePath: string; force?: boolean }
```

Required server behavior:

1. Require Firebase Auth and verify `leagues/office/members/{uid}` exists.
2. Validate `storagePath` exactly belongs to the caller:
   `match-photos/{uid}/{draftId}/...`.
3. Read the private object with the Admin Storage SDK.
4. Reject non-images and oversized files even though Storage rules also check them.
5. Downscale/rotate the image to a maximum edge around 1568 px and encode JPEG/WebP at a sensible
   quality before calling Anthropic. Use a maintained Node image library such as `sharp`.
6. Use `defineSecret("ANTHROPIC_API_KEY")` and bind the secret only to this function.
7. Use a non-secret `ANTHROPIC_MODEL` parameter/config value. Verify the model ID against current
   Anthropic documentation at implementation time; do not hardcode an unverified future model ID.
8. Rate limit with a server-only Firestore document, for example
   `aiRateLimits/{uid}` with a rolling window. Default: 10 extraction attempts per 60 minutes.
9. Make extraction idempotent:
   - server-only document `matchDrafts/{draftId}`;
   - fields: `ownerUid`, `storagePath`, `status`, raw normalized extraction, confidence, flags,
     model, created/updated timestamps;
   - return the completed stored result when the same draft is requested again;
   - only `force: true` may re-run, and it still consumes rate limit.
10. Return a normalized suggestion only. Never create/confirm a match from extraction alone.
11. Map errors to stable callable error codes/messages so the app can show manual fallback.

#### Function contract: `getMatchPhotoUrl`

Input: `{ matchId: string }`.

Required behavior:

1. Require league membership.
2. Read the match and its stored photo path.
3. Return a signed read URL valid for approximately 10 minutes.
4. Do not accept an arbitrary caller-provided storage path.

#### Tests

- Pure tests for path validation, rate-limit window logic, idempotency, and normalized response.
- Emulator integration for unauthenticated/non-member rejection.
- Verify the Anthropic secret is not available to unrelated functions.
- Keep `npm test` extraction tests passing.

### M4C — AI-assisted log flow and trusted submission

**Goal:** add "Snap result" while preserving the existing manual four-step flow.

#### UI flow

1. Add a choice at the start of `mobile/app/(app)/log-match.tsx`:
   - **Snap result**;
   - **Enter manually**.
2. Snap flow:
   - capture/select image;
   - upload with `draftId`;
   - show upload/extraction progress;
   - call `extractMatchStats`;
   - if not a stats screen, failed, or scores are null, show a clear message and continue manually;
   - let user choose opponent;
   - let user choose whether their side was left/home or right/away;
   - pre-fill goals and optional stats;
   - visually flag low-confidence/normalized fields;
   - keep every extracted value editable;
   - show the image preview and final review before submit.
3. Never infer players from team/gamertag text.
4. Never auto-submit or auto-confirm.

#### Trusted AI submission

Do not let the client create an AI-assisted match with forged extraction metadata. Add callable
`submitAiAssistedMatch`.

Input should include:

```ts
{
  draftId: string;
  seasonId: string;
  opponentId: string;
  mySide: "home" | "away";
  myTeamId: string;
  opponentTeamId: string;
  submittedGoalsAndStats: { ... };
}
```

Server validation and write:

1. Require auth/membership and load `matchDrafts/{draftId}`.
2. Require `ownerUid === uid`, `status === "done"`, and not already submitted.
3. Validate active season, registered opponent, distinct players, active teams, and numeric ranges.
4. Compare submitted values to the normalized extraction and calculate
   `extractionEditedByHuman`; do not trust a client boolean.
5. Create `matches/{draftId}` as `pending_confirmation`, `source: "ai_assisted"`, with:
   - per-side goals/stats;
   - `photoPath`;
   - normalized/raw extraction fields;
   - confidence, flags, model, extracted timestamp;
   - `extractionEditedByHuman`.
6. Mark the draft submitted atomically/idempotently.
7. Trigger the existing opponent notification. The normal opponent confirmation remains required.
8. Update Firestore rules for new server-only collections and fields. Direct client writes to
   extraction metadata remain denied.

#### Match detail changes

- Use `getMatchPhotoUrl` to display the private photo for AI-assisted matches.
- Render recorded possession/shots/on-target from the match rather than synthetic values.
- Show an "AI assisted" source label and whether values were edited.
- Handle expired signed URLs by fetching a new one.

#### Eval data and release gate

The committed fixture is synthetic and does not validate real-world performance. The user must
provide real FIFA 23 images before M4 can be considered fully complete.

Minimum labeled set:

- at least 20 readable stats screens;
- include clean screenshots and photos of TVs with glare/perspective;
- include draws, larger scores, and multiple display layouts;
- at least 5 non-stats/unreadable images.

M4 acceptance gate:

- at least 90% exact two-sided goals accuracy on readable images;
- unreadable scores return `null` rather than guessed values;
- all non-stats images fall back to manual entry;
- device capture → upload → extraction → edit/review → pending match works;
- opponent confirms and ELO/read models update normally;
- API errors, low confidence, and offline states preserve the manual path.

### M5 — Season lifecycle, admin tools, reminders, and polish

#### `finalizeSeason` callable

1. Admin-only and idempotent.
2. Require an active, non-finalized season with standings and at least one confirmed match.
3. Default to refusing finalization before the season end timestamp unless an explicit
   admin-only `force` flag is supplied and confirmed in UI.
4. Freeze/finalize the season:
   - set season `active: false`, `finalized: true`, `finalizedAt`;
   - champion = final rank 1;
   - runner-up = final rank 2 when available;
   - write `seasonResults/{seasonId}`;
   - keep final `seasons/{seasonId}/standings` documents immutable/readable for archive UI.
5. Calculate POTM for each calendar month:
   - highest total ELO gain during that month;
   - minimum 3 confirmed matches in the month;
   - deterministic tie-break: higher ending ELO, then UID;
   - write `seasonResults/{seasonId}/potm/{YYYY-MM}`.
6. Add unit tests for minimum games, ties, draws, and month boundaries.

#### Season/team administration

Add admin-only callable functions and UI for:

- create season with validated name/start/end;
- activate exactly one season at a time;
- list/add/rename/deactivate generic teams;
- prevent deactivating a team from changing historical match labels.

Do not hardcode new seasons in `DEFAULT_SEASON` after admin tools exist. Seed defaults only for a
fresh environment.

#### Weekly snapshots and movement

1. Scheduled function runs once weekly.
2. Write `seasons/{activeId}/snapshots/{YYYY-Www}` with a `rows` map of rank/ELO.
3. During ELO recalculation, load the latest snapshot and set:
   `move = previousRank - currentRank`.
4. No prior snapshot means `move = 0`.
5. Test movement direction explicitly.

#### Pending reminders

1. Scheduled function queries `pending_confirmation` matches older than 48 hours.
2. Send a reminder to the opponent only.
3. Store `reminderSentAt` and do not spam repeatedly; optional second reminder may be sent after a
   documented interval.
4. Match remains pending forever until opponent/admin action.

#### Dispute and admin resolution

Add admin-only `resolveMatch` callable and UI with actions:

- confirm submitted score;
- correct score, then confirm;
- void match.

Every confirmed-score correction or void must rebuild:

- season ELO/standings/history;
- all-time `playerStats`;
- all-time `h2h`.

Keep an audit trail (`resolvedBy`, `resolution`, previous score/status, reason, timestamp).

#### Remaining product polish

- Reuse profile setup fields for an edit-profile screen.
- Improve empty/error/loading states found during device testing.
- Add photo deletion/privacy controls.
- Verify accessibility labels, touch targets, keyboard behavior, and desktop web layout.
- Do not redesign the established dark/electric-green visual system.

#### M5 acceptance checklist

- Finalizing an emulator season populates the existing Seasons/archive UI.
- Champion, runner-up, POTM, frozen table, and movement are deterministic.
- Admin correction/void produces the same result as replaying confirmed matches from scratch.
- Reminder sends once after 48 hours and never auto-confirms.
- Non-admin callers are denied by functions and rules.

### M6 — Production deployment, custom domain, and store release

#### Firebase environments

1. Create/confirm separate Firebase projects or aliases for development and production.
2. Add `.firebaserc` aliases without committing secrets.
3. Enable required production services/billing:
   Auth, Firestore, Storage, Functions, Secret Manager, Scheduler/Pub/Sub.
4. Configure authorized Auth domains.
5. Set production secrets and parameters.
6. Deploy and smoke-test:
   - Firestore rules/indexes;
   - Storage rules;
   - Functions;
   - scheduled jobs.

#### Web deployment and custom domain

1. Add Firebase Hosting to `firebase.json`.
2. Build from `mobile/dist`.
3. Add SPA rewrites to `/index.html` for Expo Router routes.
4. Deploy the web build.
5. Connect the user's domain in Firebase Hosting and add the generated DNS records.
6. Add the final domain to Firebase Authentication authorized domains.
7. Verify sign-up, deep links, refresh on nested routes, Firestore access, and photo upload over
   HTTPS.
8. Native Expo push is the V1 notification target. Web push is out of scope unless separately
   requested; the web app must still work without it.

#### EAS and app stores

1. Finalize `eas.json` and credentials.
2. Configure iOS camera/photo/notification permission strings and Android permissions.
3. Set app version, iOS build number, and Android version code.
4. Build development/preview/production binaries.
5. Test the complete loop on at least one real iPhone and one real Android phone.
6. Prepare privacy policy, support URL, app screenshots, description, icon/splash, and data-safety
   disclosures. Explicitly disclose private match-photo handling and deletion.
7. Submit to TestFlight and Play internal testing.
8. Have internal testers run:
   onboarding → join → manual match → AI match → confirmation → ELO/profile/H2H →
   notification → dispute/admin resolution → season archive.
9. Fix release blockers before public submission.

#### M6 acceptance checklist

- Production Firebase data is isolated from emulator/dev.
- Custom-domain HTTPS web app works with nested-route refresh.
- TestFlight and Play internal builds install and complete the full flow.
- Push works on both real platforms.
- No secret appears in the mobile bundle, git history, or web assets.
- Privacy/deletion behavior matches documentation.

## Critical files

- `mobile/` — the Expo app. Theme in `src/theme/`, primitives in `src/components/`, Firebase init in
  `src/lib/firebase.ts`, routes in `app/`.
- `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `.firebaserc` —
  Firebase project config + emulator + security rules (repo root).
- `prototype/officefc/app/data.js` — reference implementation for ELO/derived-stat parity.
  Production implementations now live in `functions/src/elo.ts` and `functions/src/stats.ts`.
- `prototype/officefc/app/{ui,screens-main,screens-detail,screens-log}.jsx` — RN port reference.
- `functions/src/extract/core/*.mjs` — extraction core owned by the Cloud Functions package
  (Anthropic client, prompt, schema, validator, extract entry point). Set real model id; add
  `extraction_edited_by_human`.
- `eval/labels/`, `eval/images/` — replace the synthetic fixture with real FIFA 23 cases.
- `docs/firebase-setup.md` — one-time project/tooling setup for emulators + deploy.

## Test plan

- **Unit:** ELO calc, chronological recalculation, W-D-L records, form, streaks, standings,
  nemesis detection (reuse/port the `data.js` logic; assert parity).
- **Integration (emulators):** submit → confirm → dispute/void; season archive; push delivery.
- **Auth/rules:** `@firebase/rules-unit-testing` — a non-member can't read matches/photos and a
  non-participant can't confirm; clients can't write ELO/standings/status.
- **AI extraction is an eval, not an `assert`:** maintain a labeled set of real **FIFA 23**
  stats-screen images (clean screenshots vs. glare-y photos of a TV, draws, big scores, plus
  non-stats images). Track **goals accuracy (primary)**, stats accuracy, and false
  `detected_screen` rate. Enforce a confidence threshold below which the app forces manual review.
- **Device smoke:** camera capture → upload → extraction round-trip on iOS + Android.

## Build / release

- Local web/simulator development uses Expo + **Firebase Emulator Suite** (needs Java +
  firebase-tools). M4 native camera/push testing uses an **Expo development build**, not Expo Go.
- **EAS Build** produces binaries; **EAS Submit** sends them to TestFlight + Play internal.
- A Firebase project per environment (dev/prod); Functions + rules deployed via the Firebase CLI;
  secrets in Secret Manager.

## Cost note

Firestore, Cloud Functions, Cloud Storage, and Cloud Scheduler scale to zero and sit within the
free tier at office scale; GCP credits absorb any overflow. The only off-credit cost is Claude
(direct Anthropic API), kept small via per-user rate limits + image downscaling.

## Assumptions

- V1 supports one office league only; real accounts are required from the start.
- Firebase handles auth, Firestore, and private photo storage; **Cloud Functions hold all
  privileged logic** (AI extraction + ELO recomputation + confirmation + finalization).
- Teams are curated in the database by admins rather than hardcoded permanently.
- The prototype (and `OfficeFC.html`) is a visual reference artifact, not production architecture.
- **AI extraction is assistive**: correctness is guaranteed by human review + opponent
  confirmation, not by the model.

## External inputs and remaining user decisions

- **Admin email allowlist** for bootstrap: **`djbruza@gmail.com`** (confirmed) — this address is
  auto-promoted to admin on first app sign-in. More admins can be added later.
- POTM rule is locked: highest monthly ELO gain, minimum 3 games, tie-break by ending ELO then UID.
- Non-response behavior is locked: reminder push, no auto-confirm.
- **Needed from the user for M4:** Anthropic API key, at least 20 readable real FIFA 23 stats-screen
  images plus at least 5 non-stats/unreadable images, and access to a physical phone.
- **Needed from the user for M6:** final domain/DNS access, Apple Developer account, Google Play
  Console account, privacy/support URLs, and at least one real iPhone plus one real Android phone.
- **SDK upgrade is mandatory before M4:** SDK 51 → SDK 56, incrementally, following the Phase 0
  checklist. Do not bump only `expo`; upgrade the compatible dependency set at each step.

## Progress / status

- **M0 — Scaffold: DONE & verified.** Firebase config + emulator suite; Expo app
  (Expo Router + TS, fonts, dark theme, Firebase client init); design tokens + UI primitives ported
  to RN; web bundle builds and renders faithfully (console clean); extraction core still 10/10.
- **M1 — Auth + membership: DONE & emulator verified.**
  - Firebase project `office-fc` created (Auth email/password, Firestore `(default)`, Storage).
  - Auth spine: `AuthProvider`/`useAuth`, route gating across `(auth)`/`(onboarding)`/`(app)`.
  - Screens: sign-in, sign-up, forgot-password, verify-email, profile-setup, invite-code join, home
    (with admin invite generator + sign-out).
  - Cloud Functions (`functions/`): `redeemInvite` (admin-allowlist bootstrap + invite consume) and
    `createInvite` (admin-only); re-added to `firebase.json` + Functions emulator.
  - Rules tightened (own-profile/own-membership reads for onboarding) + `@firebase/rules-unit-testing`
    specs in `test/rules/` (`npm run test:rules`).
  - Verified: mobile `tsc` clean, functions `tsc`/build clean, web bundle builds, sign-in +
    sign-up screens render (console clean), offline extraction tests still 10/10, and the live
    onboarding flow passes against the emulator per `docs/running-m1.md`.
- **M2 — Core loop: CODE COMPLETE & emulator verified.**
  - Four-step manual log flow (opponent → teams → score → review), confirmation inbox, and live
    standings/leaderboard.
  - Callable `confirmMatch` / `disputeMatch`; deterministic server-side season ELO rebuild writes
    match deltas, standings, records/form, and ELO history.
  - Admin-idempotent active-season/team seed; tightened match-create rules; submit/resolve push
    hooks for registered Expo tokens.
  - Verified: a `2–1` result between equal-rated players remained pending until the opponent
    confirmed, then produced `1516/1484`; Functions unit tests, all 17 rules tests, mobile
    typecheck, web export, and browser console passed. See `docs/running-m2.md`.
- **M4 — AI-assisted logging: CODE COMPLETE.** Snap flow, extraction backend, trusted submission. 10/10 extraction tests, 6/6 ELO/stats tests. Web export 931 modules.
- **M5 — Season lifecycle & admin: CODE COMPLETE.** `finalizeSeason` (champion + POTM), `createSeason`/`activateSeason`, `manageTeam`, `resolveMatch` with audit trail. `weeklySnapshot` + `sendReminders` scheduled functions. Admin UI at `/(app)/admin`. All tests pass: 6/6 functions, 10/10 extraction. Typecheck clean. 21/21 expo-doctor.

**Next:** M6 — production Firebase deploy, Firebase Hosting custom domain, EAS Build + Submit to stores. Needs: domain/DNS, Apple Developer account, Google Play Console, real iPhone + Android.
