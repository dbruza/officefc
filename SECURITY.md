# Security policy

## Supported versions

Security fixes are made on `main` and shipped in the next release. Only the latest release
is supported; if you run your own deployment, update to it to receive fixes. Releases are
listed in [CHANGELOG.md](CHANGELOG.md).

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue, pull request, or
discussion.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Include what you found, the steps to reproduce it, the
affected files or functions, and the impact you expect.

We aim to acknowledge reports within a week, keep you updated while we work on a
fix, agree a disclosure date with you, and credit you in the advisory unless you'd rather
not be named.

## Scope

In scope: the code in this repository, including the app, the Cloud Functions,
`firestore.rules`, `storage.rules`, and the build and deploy scripts. Examples are a
member reading another league member's private data, a client writing trusted fields such
as ratings or roles, bypassing match confirmation, or reading match photos without a
signed URL.

Things to know before reporting:

- **Each deployment is run by its own operator.** OfficeFC is a self-hosted template; the
  maintainers don't run or have access to other people's deployments. A problem that only
  affects one deployment's configuration (for example, a weak admin password or a
  misconfigured Firebase project) should go to that deployment's operator, whose contact
  details are on its `/support` page.
- **Firebase web configuration values are public by design.** The API key, project ID, and
  other `EXPO_PUBLIC_FIREBASE_*` values are client metadata that every browser receives.
  Finding them is not a vulnerability; access is enforced by the security rules and Cloud
  Functions.
- **Secrets live in Firebase Secret Manager.** The OpenRouter API key is stored as the
  `OPENROUTER_API_KEY` secret and is never part of the app bundle. If you find a real
  secret committed to this repository or shipped in a build, report it.
- Sentry DSNs are public identifiers, not secrets.
- Denial of service through volume, social engineering, and vulnerabilities in Firebase,
  Google Cloud, Expo, or OpenRouter themselves are out of scope; report those to the
  provider.

## For operators

If you run a deployment: keep it updated, keep `ADMIN_EMAILS` to people you trust, set a
budget alert, and rotate `OPENROUTER_API_KEY` immediately if it is exposed
(`npx firebase functions:secrets:set OPENROUTER_API_KEY`, then `npm run deploy:backend`).
