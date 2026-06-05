# OfficeFC

The office FIFA league, settled by ELO. A dark, mobile-first web app for logging
matches, tracking ratings, and arguing about who really owns whom.

`OfficeFC.html` is the shipped app: a **single, self-contained HTML file**. Open it
in any browser or drop it on any static host — no server, no build step required to
run it. It loads only React + ReactDOM from a CDN; all UI and the data engine are
inlined, and the JSX is precompiled to plain JavaScript at build time (no in-browser
Babel).

## Run it

Just open `OfficeFC.html` in a browser. Or serve it locally:

```bash
npm run preview   # http://localhost:8756
```

## What's in it

Implemented faithfully from the design prototype (`prototype/officefc/`):

- **Home** — your rank, ELO, last-5 form, current win streak, nemesis, and the top of the table.
- **Leaderboard** — season filter, player search, W-D-L, ELO, and weekly movement.
- **Seasons / Hall of Fame** — the live season with a countdown + progress, plus past
  seasons with champions, runners-up, and player-of-the-month history.
- **Player profile** — big ELO number, an SVG ELO-over-time chart, record/win-rate/streak
  stats, biggest win, and head-to-head records vs everyone.
- **Match detail** — final score, teams, per-player ELO swing, and the end-of-match stats shot.
- **Head-to-head** — pick any two players for their all-time record, goals, and recent meetings.
- **Log a match** — a 5-step flow (opponent → teams → score → photo → review) with a live
  ELO-swing preview and a result celebration screen.
- **Profile setup / edit** — name, handle, jersey number, and avatar colour.

The ratings engine is standard ELO (base 1500, K=32; win/draw/loss). Every stat in the
app — records, form, streaks, head-to-head, standings, ELO history — is derived from one
deterministic match list, so the whole prototype is internally consistent.

## Project layout

```
OfficeFC.html          ← the shipped, self-contained app (generated)
build/
  build.js             ← assembles + precompiles prototype sources into OfficeFC.html
  app-shell.jsx        ← app shell (navigation/phone frame); replaces the prototype's host-only tweaks panel
  serve.js             ← tiny static server for `npm run preview`
prototype/officefc/    ← original multi-file design prototype (reference / source of truth)
mobile/                ← the production app: Expo (React Native) + Expo Router (see mobile/README.md)
firebase.json, *.rules ← Firebase config: Firestore/Storage rules, emulators
supabase/functions/    ← extraction core (reused by the Cloud Function; see AI-assisted logging below)
eval/                  ← extraction eval harness + labeled fixtures
test/                  ← offline unit/pipeline tests for the extraction core
implementationplan.md  ← the production build plan (Expo + GCP/Firebase + AI logging)
```

## AI-assisted match logging (backend slice)

The first piece of the production build: snap the end-of-match stats screen and let
Claude vision pre-fill the score + key stats for you to confirm. It lives in
`supabase/functions/extract-match-stats/` (a Supabase Edge Function) with the
correctness-critical logic — schema, prompt, parsing, and the validation guardrails —
in dependency-free ESM under `core/`, so the same code runs in Deno (deploy) and Node
(tests/eval).

```bash
npm test          # offline: validation guardrails + a mocked end-to-end pipeline
npm run eval      # offline (MOCK): runs the harness against the sample fixture
ANTHROPIC_API_KEY=sk-ant-… npm run eval   # scores the real model against the labels
```

It never auto-submits or auto-confirms — it only pre-fills the log form; opponent
confirmation stays the source of truth. See
`supabase/functions/extract-match-stats/README.md` and `eval/README.md` for details.

## Rebuild

`OfficeFC.html` is generated from the prototype sources. To regenerate after editing
anything under `prototype/officefc/` or `build/app-shell.jsx`:

```bash
npm install   # once, to get the build-time Babel transformer
npm run build
```

## Beyond the prototype

The data is an in-memory, deterministic mock so the app is a true standalone artifact.
`implementationplan.md` is the production build plan: a native **Expo (React Native)** app
backed by **GCP / Firebase** (Auth, Firestore, Cloud Functions, Storage) with accounts,
opponent-confirmed match logging, photo proof in private storage, admin-managed
seasons/teams, per-season ELO recalculation, and AI-assisted match logging.

The production app lives in **`mobile/`** (see `mobile/README.md`). M0 (scaffold + ported
design system) is done and runs on web/iOS/Android; M1+ adds auth, the match loop, and the
real screens.
