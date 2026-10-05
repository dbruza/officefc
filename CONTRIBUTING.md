# Contributing to OfficeFC

Thanks for helping. Bug fixes, documentation, tests, and features that make OfficeFC
better for self-hosted office leagues are all welcome.

For anything larger than a small fix, open an issue or a
[discussion](https://github.com/dbruza/officefc/discussions) first so we can agree on the
approach before you spend time on it. Questions about running your own league belong in
Discussions rather than issues.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security problems privately, as described in [SECURITY.md](SECURITY.md), not in a public
issue.

## Development setup

You need Node.js 24 (see `.nvmrc`), npm, Git, and Java 21 for the Firebase emulators.

The repository is not an npm workspace; install each package separately:

```bash
npm ci
npm --prefix mobile ci
npm --prefix functions ci
npm --prefix test/rules ci
```

## Running locally

Development runs against the Firebase Emulator Suite with the demo project id
`demo-officefc`, so you don't need a Firebase account or any credentials.

```bash
cp mobile/.env.example mobile/.env                    # works as-is for the emulators
npm --prefix functions run build
npx firebase emulators:start --project demo-officefc
```

Then, in another terminal:

```bash
npm --prefix mobile run web
```

The emulators take their function parameters from the committed
`functions/.env.demo-officefc`, which makes `admin@office.test` the league admin. Sign up
with that address and verify it to bootstrap a local league. Put local overrides (another
admin email, `AI_FEATURES=true`) in `functions/.env.local`, which is gitignored.

- The Emulator UI is at <http://localhost:4000>. Verification emails aren't sent; open the
  link from the Emulator UI's Authentication tab or the emulator output.
- The emulator runs the compiled functions in `functions/lib`. Run
  `npm --prefix functions run build:watch` to rebuild as you edit.
- AI features are off in the demo config. To work on them, set `AI_FEATURES=true` in
  `functions/.env.local`, `EXPO_PUBLIC_AI_FEATURES=1` in `mobile/.env`, and put
  `OPENROUTER_API_KEY=...` in `functions/.secret.local` (gitignored; the emulator reads
  secrets from it).
- Signed photo URLs can't be minted in the emulator, so viewing match photos only works
  against a deployed backend.

Native development: `npm --prefix mobile run ios` or `npm --prefix mobile run android`.
Camera, uploads, and push need a development build on a real device; see
[docs/real-device-testing.md](docs/real-device-testing.md).

## Where things live

| Path                     | Contents                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `mobile/app/`            | Expo Router routes                                              |
| `mobile/src/`            | Components, screens, data access, theme, and app logic          |
| `functions/src/`         | Cloud Functions: trusted writes, ELO, scheduled jobs, AI        |
| `firestore.rules`        | Firestore authorization boundary                                |
| `storage.rules`          | Match-photo authorization boundary                              |
| `firestore.indexes.json` | Composite indexes                                               |
| `scripts/`               | Build, environment validation, versioning, and test helpers     |
| `data/`                  | Source list for the team catalogue (`npm run import:teams`)     |
| `eval/`                  | AI extraction evaluation harness                                |
| `docs/`                  | Self-hosting guide, backend reference, runbooks, design history |

`functions/src/data/teamCatalogue.ts` and `mobile/src/lib/changelogData.ts` are generated;
don't edit them by hand. The first comes from `data/` via `npm run import:teams`, the
second from `CHANGELOG.md` via `npm run changelog:generate`.

Nothing deployment-specific belongs in the code. Per-deployment values come from Firebase
parameters (`functions/src/config.ts`, set in `functions/.env.<projectId>`) and
`EXPO_PUBLIC_*` variables (`mobile/.env`). If you add a setting, add it to
`functions/.env.example` or `mobile/.env.example` and to the
[configuration reference](docs/self-hosting.md#configuration-reference).

## Tests

| Command                  | What it runs                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `npm test`               | Root tests in `test/*.test.mjs`: extraction, ELO, competition rules, build tooling |
| `npm run test:functions` | Cloud Functions unit tests in `functions/test/`                                    |
| `npm run test:mobile`    | App logic tests in `mobile/src/lib/**/*.test.ts`                                   |
| `npm run test:rules`     | Rules tests in `test/rules/` and integration tests in `functions/integration/`     |
| `npm run eval`           | AI extraction eval harness, in mock mode (see below)                               |

### Security rules

`firestore.rules` and `storage.rules` are the security boundary: clients may propose
matches, but trusted fields (ratings, confirmations, membership roles) are only written by
Cloud Functions. Any change to the rules, or to a function that writes trusted fields,
needs tests in `test/rules/firestore.rules.test.mjs` or `functions/integration/`.

`npm run test:rules` starts its own Firestore and Storage emulators, and its Firestore
emulator uses port 8080 like the development emulators, so stop a running
`emulators:start` first.

### AI extraction eval

Changes to the extraction prompt, schema, or model should be measured with the eval
harness. See [eval/README.md](eval/README.md). Mock mode needs no network; real mode needs
an OpenRouter key and a labelled image set.

## Before you open a pull request

Run the full suite. CI runs the same steps:

```bash
npm run check
```

It covers formatting, zero-warning lint, the version and changelog sync check, the mobile
type check, a production web build, and every test suite. `npm run format` fixes most
formatting failures.

The production web build (`npm run build:web`) rejects the emulator settings in
`mobile/.env`. CI builds against placeholder values instead: see the "Create CI web
environment" step in `.github/workflows/ci.yml`, which runs the build with
`OFFICEFC_ALLOW_PLACEHOLDER_CONFIG=1`. Locally, either do the same with a temporary
`mobile/.env` or run the other steps individually; CI runs everything on your pull
request.

## Branches and pull requests

1. Fork the repository and create a branch from `main` (for example
   `fix/finals-walkover` or `feat/season-export`).
2. Make focused commits with clear, imperative messages ("Fix walkover for removed
   players", not "fixes").
3. Open a pull request against `main` and fill in the template.

Please:

- Keep each pull request to one change. Don't mix in unrelated refactors or reformatting.
- Describe what changed and why, and how you verified it.
- Add before/after screenshots for UI changes, and check both phone and desktop widths on
  the web.
- Add or update tests for behaviour changes.
- Update the docs when you change setup, configuration, or deployment.

Maintainers squash-merge pull requests into `main` and cut releases from it.

## Versioning and the changelog

`VERSION` holds the release number as `MAJOR.MINOR.PATCH.MICRO`. A release bumps `VERSION`,
adds a `CHANGELOG.md` entry under `## [X.Y.Z.W] - YYYY-MM-DD` with `### Added`,
`### Changed`, `### Fixed`, or `### Removed` sections, then runs:

```bash
npm run version:sync
```

That copies the version into `package.json` and the app config (store builds drop the MICRO
digit) and regenerates the in-app release notes. `npm run version:check` fails CI if they
drift.

Maintainers usually do this when they cut a release, so you can skip it. If your change is
user-facing, include a one- or two-line proposed changelog entry in the pull request
description, written for players rather than developers. If you do edit `CHANGELOG.md`,
run `npm run version:sync` so the check passes.

## Secrets and personal data

Never commit secrets or local configuration:

- `.env` files (`mobile/.env`, `functions/.env`, `functions/.env.<projectId>`,
  `functions/.env.local`, `functions/.secret.local`) and `.firebaserc`
- API keys, including OpenRouter keys and Sentry auth tokens
- Google service-account keys or other credentials
- Real players' data, photos, or email addresses in tests, fixtures, or screenshots

Firebase web config values aren't secrets, but they identify a deployment; keep them out of
committed files and use placeholders in examples. If you commit a secret by mistake, rotate
it straight away: removing it from Git history does not make it safe again.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers the project.
