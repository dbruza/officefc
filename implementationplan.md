# OfficeFC Implementation Plan

> Single source of truth. Consolidates the original build plan, the plan-mode gap review,
> the locked product decisions, the GCP/Firebase re-platform, and live build status.

## Summary

Build OfficeFC as a **native mobile app (Expo / React Native)** backed by **Google Cloud /
Firebase (serverless)**, with **AI-assisted match logging**: snap the end-of-match stats screen
and Claude vision pre-fills the score and key stats for the player to confirm.

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
- **Secrets:** **Secret Manager** holds `ANTHROPIC_API_KEY` (and model id); never on-device.
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
- Photo (subdoc or fields on the match) — Storage path, `extracted_json` (map),
  `extraction_status` (`pending`|`done`|`failed`), `extraction_confidence`, `extraction_model`,
  `extracted_at`, **`extraction_edited_by_human`**.
- **Materialized by the recalc function** (Firestore has no joins):
  - `seasons/{id}/standings/{uid}` — rank, elo, w, d, l, gf, ga, form(last5), **move**.
  - `seasons/{id}/snapshots/{weekKey}/{uid}` — rank, elo (weekly, for movement).
  - `seasons/{id}/eloHistory/{uid}` — compact rating-over-time series for the profile chart.
  - `playerStats/{uid}` — all-time record, streaks, biggest win, nemesis.
  - `h2h/{pairKey}` — all-time head-to-head aggregate per player pair.
  - `seasonResults/{seasonId}` — championId, runnerUpId; `seasonResults/{id}/potm/{month}` — playerId.
- `deviceTokens/{uid}/{tokenId}` — expoPushToken, platform.

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

The plan-mode review of the original (Supabase) plan surfaced these gaps; each is now resolved in
the model/lifecycle above. Recorded here so the "why" isn't lost:

- **ELO season scope** was undefined → **reset per season** (prototype-faithful); recompute from
  confirmed season matches only.
- **Auth + join** was vague ("email allowlist on sign-in") → **email/password + admin invite
  codes** (`invites` collection), with an admin email allowlist only for bootstrapping.
- **Weekly leaderboard movement** had nowhere to come from → `seasons/{id}/snapshots` written
  weekly by Cloud Scheduler; `move` = current rank − last snapshot rank.
- **Season finalization / Hall of Fame** (champion, runner-up, player-of-the-month) had no storage
  → `seasonResults` + `.../potm` + frozen `standings`. **POTM rule:** highest ELO gain in the
  calendar month, min 3 games (prototype hardcodes it — confirm).
- **Push** relied on tokens that weren't modeled → `deviceTokens`; functions send Expo push on
  submit / confirm / dispute.
- **Profile ELO chart** source → `seasons/{id}/eloHistory/{uid}`, written on recalc.
- **ELO recalc trigger** was unspecified → `recalcSeasonElo(seasonId)` Cloud Function, run on any
  season-match status change; deterministic, server-side, tamper-proof.
- **Confirmation** could have been a client write → it's a **callable function** (anti-cheat).
- **Opponents must be registered members**; **non-response stays pending** (reminder push, no
  auto-confirm); **post-confirm edits are admin-only** and trigger recalc.
- **AI practicals**: real FIFA 23 eval images still needed; model id is a placeholder; downscale
  before send; per-user rate limit + idempotency.
- **Security**: explicit Firestore/Storage rules (members read; functions write) + rules-unit-tests.

## Build sequence (MVP-first, with verification)

- **M0 — Scaffold.** ✅ **DONE.** Expo + Expo Router + TS; Firebase config + Emulator Suite; design
  tokens + UI primitives ported from `prototype/officefc/app/ui.jsx` to RN.
  *Verified:* `tsc` clean → web bundle builds → renders & screenshots faithfully on RN Web →
  console clean; extraction tests still 10/10.
- **M1 — Auth + membership.** Email/password (verify + reset), profile setup, admin invite-code
  join, league seed, tightened Firestore/Storage rules, admin bootstrap.
  *Verify:* two emulator users join via code; `@firebase/rules-unit-testing` proves a non-member
  can't read and clients can't write trusted fields.
- **M2 — Core loop, no AI.** Manual log flow (opponent → teams → score → review); create
  `pending_confirmation`; `confirmMatch` + `recalcSeasonElo` functions; standings/leaderboard;
  push on submit/confirm.
  *Verify:* submit→confirm moves ELO and matches a hand-calc; voided/disputed excluded.
- **M3 — Read-screen parity.** Home, player profile + SVG ELO chart, match detail, head-to-head,
  seasons/Hall of Fame — reading materialized Firestore docs.
  *Verify:* RN Web screenshots match the prototype; derived stats equal `data.js` for the same
  match list.
- **M4 — AI-assisted logging.** Port `extract-match-stats` to a Node Cloud Function (reuse
  `core/*.mjs`); wire "Snap result" (upload → extract → pre-fill + review); rate-limit + downscale;
  collect real FIFA 23 images and measure with the eval.
  *Verify:* device round-trip; `npm run eval` ≥ target goals accuracy; non-stats image → manual.
- **M5 — Season lifecycle + polish.** Admin `finalizeSeason` (freeze standings, champion/runner-up,
  POTM); weekly `snapshots` for movement; dispute/void admin tools.
  *Verify:* finalize archives a season; movement renders; POTM rule holds.
- **M6 — Release.** EAS Build + Submit → TestFlight + Play internal.
  *Verify:* internal testers run the full loop on real hardware.

## Critical files

- `mobile/` — the Expo app. Theme in `src/theme/`, primitives in `src/components/`, Firebase init in
  `src/lib/firebase.ts`, routes in `app/`.
- `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `.firebaserc` —
  Firebase project config + emulator + security rules (repo root).
- `prototype/officefc/app/data.js` — lift the ELO + derived-stat functions into `recalcSeasonElo`
  (record, form, streaks, biggestWin, h2h, standings, nemesis).
- `prototype/officefc/app/{ui,screens-main,screens-detail,screens-log}.jsx` — RN port reference.
- `supabase/functions/extract-match-stats/core/*.mjs` — **reused unchanged**; migrate alongside a
  new Node handler (e.g. `functions/src/extract/`), retire the Deno `index.ts`. Set real model id;
  add `extraction_edited_by_human`.
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

- Dev via Expo Go + **Firebase Emulator Suite** (needs Java + firebase-tools); **EAS Build** for
  binaries; **EAS Submit** to TestFlight + Play internal.
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

## Open items (defaults noted)

- **Admin email allowlist** for bootstrap (default: `djbruza@gmail.com`).
- POTM = highest monthly ELO gain, min 3 games (default: yes).
- Non-response stays pending + reminder push, no auto-confirm (default: yes).
- FIFA 23 console(s) for the eval label set (default: unspecified, generic reader).

## Progress / status

- **M0 — Scaffold: DONE & verified.** Firebase config + emulator suite; Expo app
  (Expo Router + TS, fonts, dark theme, Firebase client init); design tokens + UI primitives ported
  to RN; web bundle builds and renders faithfully (console clean); extraction core still 10/10.
- **Paused before M1** so the dev Firebase project + local tooling (Java, firebase-tools) can be
  set up — see `docs/firebase-setup.md`. M1 resumes on confirmation.
- The AI extraction backend slice (schema, prompt, Anthropic client, validation guardrails, offline
  tests, eval harness) is built and tested under `supabase/functions/extract-match-stats/`, ready to
  be wrapped as a Node Cloud Function in M4.
