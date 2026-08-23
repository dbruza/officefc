# OfficeFC

Expo + Firebase app for office EA Sports FC leagues: ELO ratings, confirmed match tracking, finals brackets.

- Feature work happens on `development`; `main` is deploy-only (PRs squash development → main).
- Mobile app lives in `mobile/` (Expo SDK 56, expo-router), trusted writes in `functions/` (Firebase Functions v2, Node 20).
- Full check suite: `npm run check` (format, lint, version sync, mobile typecheck, web build, functions tests, root tests, rules tests).
- Releases: bump `VERSION` (MAJOR.MINOR.PATCH.MICRO) and add a CHANGELOG entry, then `npm run version:sync` to push it into `package.json` and `mobile/app.json` (store builds drop the MICRO digit). `npm run version:check` fails CI on drift.
