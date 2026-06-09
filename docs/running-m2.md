# Running M2 locally

> Historical milestone runbook. For the current setup and release state, see
> [Firebase setup](firebase-setup.md) and the
> [implementation overview](implementation-plan.md).

M2 adds the first complete competitive loop:

1. one player logs a manual result;
2. the named opponent confirms or disputes it;
3. confirmed matches rebuild the active season's ELO, standings, records, form, and history.

## Start the app

From the repository root:

```bash
firebase emulators:start
```

In a second terminal:

```bash
cd mobile
npm run web
```

Open the app at `http://127.0.0.1:8081` and the Emulator UI at
`http://127.0.0.1:4000`.

## First M2 setup

An admin automatically seeds the active `Summer Showdown` season and the generic team catalogue
when the dashboard first loads. The setup is idempotent.

You need two verified league members to test confirmation:

- sign in as the admin;
- generate and redeem an invite with a second account;
- complete that account's profile.

## Exercise the loop

As player A:

1. Tap **Log match**.
2. Pick player B, both teams, and a final score.
3. Check the ELO preview and submit.
4. Confirm that `matches/{id}` is `pending_confirmation` and has no ELO fields yet.

As player B:

1. Open the confirmation inbox (the check button beside **Log match**).
2. Confirm the result.
3. Return to the dashboard and check the table.

For two players starting at `1500`, a decisive result should produce `+16` and `-16`. Firestore
should now contain:

- ELO before/after/delta fields on the confirmed match;
- `seasons/{seasonId}/standings/{uid}`;
- `seasons/{seasonId}/eloHistory/{uid}`.

Disputing instead sets the match to `disputed`; it remains excluded from ELO and standings.

## Validation

```bash
npm --prefix functions test
npm --prefix mobile run typecheck
npm --prefix mobile run export:web
npm run test:rules
```

If the full rules command says port `8080` is already in use because the suite is running, execute
`npm --prefix test/rules test` against that existing emulator.

## Push boundary

The Functions send submit/confirm/dispute messages to any Expo tokens already stored under
`deviceTokens/{uid}/tokens/{tokenId}`. Device-token registration is implemented through the
native development-build workflow and `expo-notifications`.
