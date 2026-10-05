# OfficeFC

Expo + Firebase app for office EA Sports FC leagues: ELO ratings, confirmed match tracking, finals brackets. Open source (MIT), distributed as a self-hosted template: each deployment is its own Firebase project running one league (league id fixed to `office`).

- Pull requests go against `main` from a feature branch; maintainers squash-merge and cut releases. See CONTRIBUTING.md.
- Mobile app lives in `mobile/` (Expo SDK 56, expo-router), trusted writes in `functions/` (Firebase Functions v2, Node 24).
- No hardcoded project ids, regions, or emails. Per-deployment config lives in Firebase params (`functions/src/config.ts`, values in `functions/.env.<projectId>`), the `OPENROUTER_API_KEY` secret, `mobile/.env` (`EXPO_PUBLIC_*`, see `mobile/.env.example`), and EAS env vars for native builds (`mobile/app.config.ts`). The active project comes from `npx firebase use`; local emulators and tests use `demo-officefc`. New settings go in the matching `.env.example` and the configuration reference in `docs/self-hosting.md`.
- Full check suite: `npm run check` (format, lint, version sync, mobile typecheck, web build, functions tests, root tests, rules tests).
- Releases: bump `VERSION` (MAJOR.MINOR.PATCH.MICRO) and add a CHANGELOG entry, then `npm run version:sync` to push it into `package.json` and `mobile/app.json` (store builds drop the MICRO digit). `npm run version:check` fails CI on drift.
