# OfficeFC Implementation Overview

This document records the current architecture, completed product milestones, and remaining
release work. The production application lives in `mobile/`; the original standalone
prototype in `prototype/officefc/` remains a visual reference only.

## Product Rules

- OfficeFC is an invite-only office league for EA Sports FC/FIFA matches.
- Every player starts at 1500 ELO.
- Match statistics can influence the rating change while preserving a zero-sum result.
- A submitted match stays pending until the opponent confirms it.
- Disputed matches do not affect ratings until an admin resolves them.
- AI photo extraction is assistive: it pre-fills fields and never confirms a match.
- Match evidence is private and is read through short-lived signed URLs.

## Architecture

### Client

The Expo 56 application targets web, iOS, and Android with Expo Router and TypeScript. It
contains authentication, onboarding, standings, player profiles, match logging,
confirmations, head-to-head records, season archives, profile editing, and administration.

### Firebase

- **Authentication:** email/password accounts and email verification.
- **Firestore:** leagues, memberships, teams, seasons, matches, ratings, and derived read
  models.
- **Storage:** private match photos protected by ownership and membership rules.
- **Cloud Functions:** invite redemption, trusted match lifecycle, ELO recalculation,
  administration, signed photo access, and AI-assisted extraction.
- **Scheduled Functions:** weekly snapshots, confirmation reminders, and stale draft cleanup.
- **Hosting:** static Expo web export with single-page application rewrites.

### AI Extraction

The extraction core is shared by the Cloud Function and the offline evaluation harness. It
validates model output, rejects non-match screens, flags low-confidence reads, clamps
impossible statistics, and always leaves final review to the submitting player.

## Delivery Status

### Complete

- Expo and Firebase project scaffolding
- Authentication, profiles, membership, and invite codes
- Manual match submission, confirmation, disputes, and ELO updates
- Standings, dashboards, player profiles, head-to-head, and match detail
- Season history, archives, player of the month, and administration
- AI-assisted photo upload, extraction, review, and trusted submission
- Team catalogue synchronization and admin-created teams
- Push token registration, reminders, weekly snapshots, and cleanup jobs
- Firebase Hosting export and deployment scripts
- Unit, backend, extraction, and security-rules coverage

### Release Work

- Deploy the Firebase backend and Hosting release to the production project.
- Connect and verify `officefc.bruza.tech`.
- Run the complete two-account production smoke test.
- Validate camera, upload, push, and deep-link behavior on real iOS and Android devices.
- Evaluate AI extraction against at least 20 varied real match-stat images.
- Create signed EAS builds and complete App Store and Play Store submission.

## Quality Gates

Before a release:

1. Run `npm run check`.
2. Confirm the production web bundle contains no emulator endpoints.
3. Verify Firestore and Storage rules against the emulator suite.
4. Exercise manual logging even when AI extraction is unavailable.
5. Test submission, confirmation, dispute, admin resolution, and season finalization.
6. Verify photos remain inaccessible through direct Storage reads.
7. Check scheduled Functions and production logs after deployment.

Operational and deployment details live in:

- [Web MVP launch](web-mvp-launch.md)
- [Real-device testing](real-device-testing.md)
- [Firebase setup](firebase-setup.md)
- [AI extraction evaluation](../eval/README.md)
