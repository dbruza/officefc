# Multi-league groundwork assessment (2026-08-25)

## Verdict

Multi-league is **not blocked by scattered hardcodes** — it is blocked by the security
model. The codebase is more centralized than assumed; what remains is one rules rewrite,
one membership-model decision, and a per-feature isolation audit. Estimated effort once
a second league is real: ~1 focused sprint, most of it rules + migration work.

## Current state

- League id lives in exactly two constants: `mobile/src/lib/constants.ts` and
  `functions/src/config.ts` (`LEAGUE_ID = "office"`). All 11 functions-side path
  constructions use the constant; mobile has 2 (`membership.ts`, `league/players.ts`).
- No raw `"office"` strings anywhere else in app or functions code.
- Firestore rules hardcode the league in 4 places (`isMember`, `memberRole`,
  `isLeagueMember` + comment) — this is the real coupling.

## What a second league actually requires

1. **Rules rewrite (the core work).** Replace the fixed-path membership lookups with
   `match /leagues/{leagueId}/members/{uid}` wildcards and thread the caller's league
   through every check. Every rule that reads another user's membership
   (`isLeagueMember(userId)`) must know *which* league to ask — match creations validate
   opponents cross-user, so league context cannot come from the auth uid alone; it has to
   come from the document being written (`request.resource.data.leagueId`) with an added
   constraint that the writer is a member of THAT league.
2. **League context on writes.** Match docs, drafts, votes, predictions, cup/seasons docs
   all live under or reference the implicit "office" league. Two viable models:
   - **Subordinate collections** (`leagues/{id}/matches/...`) — clean isolation, big
     migration of existing collections.
   - **Keep flat + `leagueId` field** on every doc — smaller migration, but every query
     and every rule gains a league filter forever, and forgetting one leaks data across
     leagues.
   Recommendation if this ever ships: subordinate collections, migrated once.
3. **Membership model.** `redeemInvite` bootstraps a single league and allowlists admin
   by email globally. Needs invite-per-league and role scoped per league.
4. **Per-feature audit.** Every consumer added since v1 (activity feed, finals bracket,
   predictions, votes, cup, recap) was written against the single-league assumption.
   Each needs a pass confirming its queries/rules carry league context. The finals-
   exclusion discipline (`finals == true` filters everywhere) is the template for how
   easy it is to forget one call site.
5. **Client context.** One `LEAGUE_ID` import per data module means threading a chosen
   league through hooks/screens (or a league-context provider). Mechanical but broad.

## What was deliberately NOT done now

No path-builder abstractions or speculative threading were added: with only two mobile
construction sites, a helper layer saves nothing and adds indirection. The constants are
the abstraction. Revisit this doc when a second office actually wants in.
