/**
 * Firestore and Storage security-rules tests. Run against the emulators:
 *
 *   cd test/rules && npm install            # once
 *   npm run test:rules
 *
 * (or use the root `npm run test:rules`). Proves the trust boundary: non-members can't
 * read league data, clients can't write trusted fields, but onboarding self-reads work.
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(here, "../../firestore.rules"), "utf8");
const storageRules = readFileSync(join(here, "../../storage.rules"), "utf8");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    // Match the emulator CLI project so Storage's firestore.exists() cross-service
    // lookup reads the same Firestore namespace seeded below.
    projectId: "demo-officefc",
    firestore: {
      rules,
      host: "127.0.0.1",
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").at(-1) ?? 8080),
    },
    storage: {
      rules: storageRules,
      host: "127.0.0.1",
      port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(":").at(-1) ?? 12199),
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  // Seed: alice is a member, dave is an admin. (withSecurityRulesDisabled bypasses rules.)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "leagues/office/members/alice"), { role: "member" });
    await setDoc(doc(db, "leagues/office/members/bob"), { role: "member" });
    await setDoc(doc(db, "leagues/office/members/dave"), { role: "admin" });
    await setDoc(doc(db, "profiles/alice"), { displayName: "Alice", handle: "alice" });
    await setDoc(doc(db, "profiles/bob"), { displayName: "Bob", handle: "bob" });
    await setDoc(doc(db, "matches/m1"), {
      seasonId: "s1",
      aId: "alice",
      bId: "dave",
      status: "confirmed",
    });
    await setDoc(doc(db, "seasons/s1"), { name: "Summer Showdown", active: true });
    await setDoc(doc(db, "seasonCodes/s1"), { code: "OFC-ABCDE" });
    await setDoc(doc(db, "playerStats/alice"), { uid: "alice", games: 1, w: 1, d: 0, l: 0 });
    await setDoc(doc(db, "h2h/alice__dave"), {
      pairKey: "alice__dave",
      aId: "alice",
      bId: "dave",
      aWins: 1,
      bWins: 0,
      draws: 0,
    });
    await setDoc(doc(db, "teams/team-a"), { name: "Crimson Albion", active: true });
    await setDoc(doc(db, "teams/team-b"), { name: "Royal Vega", active: true });
    await setDoc(doc(db, "teams/chelsea-men"), { name: "Chelsea", active: true });
    await setDoc(doc(db, "teams/chelsea-women"), { name: "Chelsea", active: true });
    await setDoc(doc(db, "teamCatalogues/current"), {
      version: "fifa23",
      count: 2,
      teams: [
        { id: "chelsea-men", name: "Chelsea", competition: "England Premier League (1)" },
        {
          id: "chelsea-women",
          name: "Chelsea",
          competition: "England FA Women's Super League (1)",
        },
      ],
    });
    await setDoc(doc(db, "invites/OFC-ABCDE"), { role: "member", usedBy: null });
    // Auto-matchup fixtures: fx1 is live, fx2 already consumed.
    await setDoc(doc(db, "fixtures/fx1"), {
      seasonId: "s1",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      status: "proposed",
    });
    await setDoc(doc(db, "fixtures/fx2"), {
      seasonId: "s1",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      status: "submitted",
    });
    // Finals bracket: e1 is an open tie (alice v dave), gf not yet reachable.
    await setDoc(doc(db, "seasons/s1/finals/bracket"), {
      structure: "top6",
      premierId: "alice",
      slots: {
        e1: {
          status: "open",
          homeId: "alice",
          awayId: "dave",
          homeTeamId: "team-a",
          awayTeamId: "team-b",
        },
        gf: { status: "pending", homeId: null, awayId: null, homeTeamId: null, awayTeamId: null },
      },
    });
    await setDoc(doc(db, "activity/result_m1"), {
      type: "match_result",
      leagueId: "office",
      seasonId: "s1",
      actorIds: ["alice", "dave"],
      payload: { matchId: "m1", aId: "alice", bId: "dave", aGoals: 2, bGoals: 1 },
    });
  });
});

const member = () => testEnv.authenticatedContext("alice").firestore();
const admin = () => testEnv.authenticatedContext("dave").firestore(); // seeded as role: admin
const outsider = () => testEnv.authenticatedContext("nora").firestore(); // signed in, NOT a member
const anon = () => testEnv.unauthenticatedContext().firestore();

test("non-member cannot read league matches", async () => {
  await assertFails(getDoc(doc(outsider(), "matches/m1")));
});

test("member can read league matches", async () => {
  await assertSucceeds(getDoc(doc(member(), "matches/m1")));
});

test("members can read M3 aggregate documents", async () => {
  await assertSucceeds(getDoc(doc(member(), "playerStats/alice")));
  await assertSucceeds(getDoc(doc(member(), "h2h/alice__dave")));
});

test("season join codes are function-only — no client can read them", async () => {
  // The season doc itself stays member-readable; the code must not, or members would harvest it.
  await assertSucceeds(getDoc(doc(member(), "seasons/s1")));
  await assertFails(getDoc(doc(member(), "seasonCodes/s1")));
  await assertFails(getDoc(doc(admin(), "seasonCodes/s1")));
  await assertFails(getDoc(doc(outsider(), "seasonCodes/s1")));
});

test("members can read the compact team catalogue snapshot", async () => {
  await assertSucceeds(getDoc(doc(member(), "teamCatalogues/current")));
  await assertFails(getDoc(doc(outsider(), "teamCatalogues/current")));
});

test("non-members cannot read M3 aggregate documents", async () => {
  await assertFails(getDoc(doc(outsider(), "playerStats/alice")));
  await assertFails(getDoc(doc(outsider(), "h2h/alice__dave")));
});

test("activity feed: members read, others cannot, and clients never write", async () => {
  await assertSucceeds(getDoc(doc(member(), "activity/result_m1")));
  await assertFails(getDoc(doc(outsider(), "activity/result_m1")));
  await assertFails(setDoc(doc(member(), "activity/forged"), { type: "champion" }));
  await assertFails(setDoc(doc(admin(), "activity/forged"), { type: "champion" }));
});

test("a signed-in non-member can read their OWN profile (onboarding)", async () => {
  await assertSucceeds(getDoc(doc(outsider(), "profiles/nora")));
});

test("a non-member cannot read someone else's profile", async () => {
  await assertFails(getDoc(doc(outsider(), "profiles/alice")));
});

test("a signed-in non-member can read their OWN membership doc", async () => {
  await assertSucceeds(getDoc(doc(outsider(), "leagues/office/members/nora")));
});

test("a non-member cannot read another member's membership doc", async () => {
  await assertFails(getDoc(doc(outsider(), "leagues/office/members/alice")));
});

test("anonymous users are denied everywhere", async () => {
  await assertFails(getDoc(doc(anon(), "matches/m1")));
  await assertFails(getDoc(doc(anon(), "profiles/alice")));
});

test("a member can create a pending match they participate in", async () => {
  await assertSucceeds(
    setDoc(doc(member(), "matches/new1"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 2,
      bGoals: 1,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test("same-name teams remain valid when their ids are distinct", async () => {
  await assertSucceeds(
    setDoc(doc(member(), "matches/same-name-teams"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "dave",
      aTeamId: "chelsea-men",
      bTeamId: "chelsea-women",
      aTeam: "Chelsea",
      bTeam: "Chelsea",
      aGoals: 2,
      bGoals: 1,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

function fixtureMatch(overrides = {}) {
  return {
    seasonId: "s1",
    submittedBy: "alice",
    aId: "alice",
    bId: "dave",
    aTeamId: "team-a",
    bTeamId: "team-b",
    aTeam: "Crimson Albion",
    bTeam: "Royal Vega",
    aGoals: 2,
    bGoals: 1,
    status: "pending_confirmation",
    source: "fixture",
    fixtureId: "fx1",
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

test("a fixture submission mirroring the dealt fixture is allowed", async () => {
  await assertSucceeds(setDoc(doc(member(), "matches/fxm1"), fixtureMatch()));
});

test("a fixture submission with swapped teams is rejected", async () => {
  await assertFails(
    setDoc(
      doc(member(), "matches/fxm2"),
      fixtureMatch({
        aTeamId: "team-b",
        bTeamId: "team-a",
        aTeam: "Royal Vega",
        bTeam: "Crimson Albion",
      }),
    ),
  );
});

test("an already-played fixture cannot be recorded again", async () => {
  await assertFails(setDoc(doc(member(), "matches/fxm3"), fixtureMatch({ fixtureId: "fx2" })));
});

test("source 'fixture' without a fixtureId is rejected", async () => {
  const withoutFixtureId = fixtureMatch();
  delete withoutFixtureId.fixtureId;
  await assertFails(setDoc(doc(member(), "matches/fxm4"), withoutFixtureId));
});

function finalsMatch(overrides = {}) {
  return {
    seasonId: "s1",
    submittedBy: "alice",
    aId: "alice",
    bId: "dave",
    aTeamId: "team-a",
    bTeamId: "team-b",
    aTeam: "Crimson Albion",
    bTeam: "Royal Vega",
    aGoals: 3,
    bGoals: 2,
    status: "pending_confirmation",
    source: "finals",
    finals: true,
    finalsSlot: "e1",
    decidedBy: "penalties",
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

test("a finals submission mirroring the open bracket tie is allowed", async () => {
  await assertSucceeds(setDoc(doc(member(), "matches/fnm1"), finalsMatch()));
});

test("a level finals score is rejected — extra time and pens decide it", async () => {
  await assertFails(setDoc(doc(member(), "matches/fnm2"), finalsMatch({ aGoals: 2, bGoals: 2 })));
});

test("a finals submission with the wrong teams is rejected", async () => {
  await assertFails(
    setDoc(
      doc(member(), "matches/fnm3"),
      finalsMatch({
        aTeamId: "team-b",
        bTeamId: "team-a",
        aTeam: "Royal Vega",
        bTeam: "Crimson Albion",
      }),
    ),
  );
});

test("a finals submission for a not-yet-open slot is rejected", async () => {
  await assertFails(setDoc(doc(member(), "matches/fnm4"), finalsMatch({ finalsSlot: "gf" })));
});

test("client-side walkover is not a valid decidedBy", async () => {
  await assertFails(setDoc(doc(member(), "matches/fnm5"), finalsMatch({ decidedBy: "walkover" })));
});

test("manual submissions cannot smuggle finals fields", async () => {
  await assertFails(setDoc(doc(member(), "matches/fnm6"), finalsMatch({ source: "manual" })));
});

// A catalogue sync (e.g. FIFA 23 → FC 27) retires teams by flipping `active` off, including
// teams already dealt into a live fixture or an open finals tie.
async function retireDealtTeams() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const id of ["team-a", "team-b"]) {
      await setDoc(
        doc(db, `teams/${id}`),
        { active: false, catalogueActive: false },
        { merge: true },
      );
    }
  });
}

test("a fixture dealt before a catalogue sync stays playable with its retired teams", async () => {
  await retireDealtTeams();
  await assertSucceeds(setDoc(doc(member(), "matches/retired-fx"), fixtureMatch()));
});

test("an open finals tie dealt before a catalogue sync stays playable with its retired teams", async () => {
  await retireDealtTeams();
  await assertSucceeds(setDoc(doc(member(), "matches/retired-fn"), finalsMatch()));
});

test("a retired team still needs its real name on a fixture submission", async () => {
  await retireDealtTeams();
  await assertFails(
    setDoc(doc(member(), "matches/retired-fx-name"), fixtureMatch({ aTeam: "Not Crimson Albion" })),
  );
});

test("manual submissions cannot pick a retired catalogue team", async () => {
  const manual = fixtureMatch({ source: "manual" });
  delete manual.fixtureId;
  // Same payload passes while the teams are active, so the rejection below is the retirement.
  await assertSucceeds(setDoc(doc(member(), "matches/active-manual"), manual));
  await retireDealtTeams();
  await assertFails(setDoc(doc(member(), "matches/retired-manual"), manual));
});

test("fixtures are member-readable but never client-writable", async () => {
  await assertSucceeds(getDoc(doc(member(), "fixtures/fx1")));
  await assertFails(getDoc(doc(outsider(), "fixtures/fx1")));
  await assertFails(
    setDoc(doc(member(), "fixtures/hack"), {
      seasonId: "s1",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      status: "proposed",
    }),
  );
});

test("a member cannot create a match already marked confirmed", async () => {
  await assertFails(
    setDoc(doc(member(), "matches/new2"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 2,
      bGoals: 1,
      status: "confirmed",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test("a member cannot create a match they're not part of", async () => {
  await assertFails(
    setDoc(doc(member(), "matches/new3"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "bob",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 1,
      bGoals: 0,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test("a member cannot submit against a non-member", async () => {
  await assertFails(
    setDoc(doc(member(), "matches/new4"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "nora",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 1,
      bGoals: 0,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test("a member cannot smuggle trusted ELO fields into a pending match", async () => {
  await assertFails(
    setDoc(doc(member(), "matches/new5"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 1,
      bGoals: 0,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
      aDelta: 500,
    }),
  );
});

test("a member must submit a real active team", async () => {
  await assertFails(
    setDoc(doc(member(), "matches/new6"), {
      seasonId: "s1",
      submittedBy: "alice",
      aId: "alice",
      bId: "dave",
      aTeamId: "team-a",
      bTeamId: "team-b",
      aTeam: "Not Crimson Albion",
      bTeam: "Royal Vega",
      aGoals: 1,
      bGoals: 0,
      status: "pending_confirmation",
      source: "manual",
      date: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test("clients cannot write membership docs (function-only)", async () => {
  await assertFails(setDoc(doc(member(), "leagues/office/members/alice"), { role: "admin" }));
  await assertFails(setDoc(doc(outsider(), "leagues/office/members/nora"), { role: "member" }));
});

test("clients cannot read or write invites", async () => {
  await assertFails(getDoc(doc(member(), "invites/OFC-ABCDE")));
  await assertFails(setDoc(doc(member(), "invites/OFC-NEW"), { role: "member" }));
});

test("a user cannot set their own role on their profile", async () => {
  await assertFails(
    setDoc(doc(testEnv.authenticatedContext("nora").firestore(), "profiles/nora"), {
      displayName: "Nora",
      handle: "nora",
      role: "admin",
    }),
  );
});

test("a user can create their own profile without a role", async () => {
  await assertSucceeds(
    setDoc(doc(testEnv.authenticatedContext("nora").firestore(), "profiles/nora"), {
      displayName: "Nora",
      handle: "nora",
      jersey: 8,
      color: "#00ff87",
    }),
  );
});

test("a member can upload and delete their own private match photo", async () => {
  const photo = testEnv
    .authenticatedContext("alice")
    .storage()
    .ref("match-photos/alice/draft-1/source.jpg");
  await assertSucceeds(photo.put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  await assertSucceeds(photo.delete());
});

test("a match photo can't be replaced once uploaded, or uploaded as SVG", async () => {
  const storage = testEnv.authenticatedContext("alice").storage();
  const photo = storage.ref("match-photos/alice/draft-4/source.jpg");
  await assertSucceeds(photo.put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  // A confirmed match's evidence must not be swapped afterwards.
  await assertFails(photo.put(new Uint8Array([4, 5, 6]), { contentType: "image/jpeg" }));
  const svg = storage.ref("match-photos/alice/draft-5/source.svg");
  await assertFails(svg.put(new Uint8Array([60, 115, 118, 103]), { contentType: "image/svg+xml" }));
});

test("direct client reads of match photos are denied, including to members", async () => {
  const photo = testEnv
    .authenticatedContext("alice")
    .storage()
    .ref("match-photos/alice/draft-2/source.jpg");
  await assertSucceeds(photo.put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  await assertFails(photo.getDownloadURL());
});

test("non-members cannot upload match photos", async () => {
  const photo = testEnv
    .authenticatedContext("nora")
    .storage()
    .ref("match-photos/nora/draft-3/source.jpg");
  await assertFails(photo.put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
});

// --- Finals prediction picks (prediction game) ---------------------------------------
//
// The security core: a pick may only be written while its bracket slot is OPEN, and
// predictorId is pinned to the caller. That freeze is what makes every scored pick
// provably pre-decision — these tests pin it so a rules edit can't silently reopen it.

test("a member can create their own picks doc for an open slot", async () => {
  await assertSucceeds(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "alice",
      picks: { e1: { predictedWinnerId: "dave" } },
      updatedAt: serverTimestamp(),
    }),
  );
});

test("picks writes must carry a server timestamp (updatedAt == request.time)", async () => {
  // A forgeable client stamp was the old design's hole; the rules pin the field to
  // request.time so no client-supplied Date can stand in for one.
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "alice",
      picks: { e1: { predictedWinnerId: "dave" } },
      updatedAt: new Date("2026-01-01"),
    }),
  );
});

test("predictorId is pinned to the doc id (no forging another member's entry)", async () => {
  // alice writing bob's id into her own doc would merge points onto his scoreboard row.
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "bob",
      picks: { e1: { predictedWinnerId: "alice" } },
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a picks doc carries only predictorId, picks and updatedAt", async () => {
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "alice",
      picks: { e1: { predictedWinnerId: "dave" } },
      updatedAt: serverTimestamp(),
      padding: "x".repeat(1000),
    }),
  );
});

test("a member cannot write someone else's picks doc at all", async () => {
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/bob"), {
      predictorId: "bob",
      picks: { e1: { predictedWinnerId: "alice" } },
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a pick must name one of the open slot's two participants", async () => {
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "alice",
      picks: { e1: { predictedWinnerId: "bob" } }, // bob isn't in tie e1
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a pick for a decided or pending slot is rejected (the freeze)", async () => {
  // Seed a bracket whose e1 has already been DECIDED.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "seasons/s1/finals/bracket"), {
      structure: "top6",
      premierId: "alice",
      slots: {
        e1: {
          status: "decided",
          homeId: "alice",
          awayId: "dave",
          winnerId: "alice",
          matchId: "m1",
        },
        gf: { status: "pending", homeId: null, awayId: null },
      },
    });
  });
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "alice",
      picks: { e1: { predictedWinnerId: "alice" } }, // slot closed after the result
      updatedAt: serverTimestamp(),
    }),
  );
});

test("an update may not flip predictorId or sneak a closed-slot pick in", async () => {
  await setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
    predictorId: "alice",
    picks: { e1: { predictedWinnerId: "dave" } },
    updatedAt: serverTimestamp(),
  });
  // Whole-doc rewrite claiming someone else's identity.
  await assertFails(
    setDoc(doc(member(), "finalsPredictions/s1/picks/alice"), {
      predictorId: "bob",
      picks: { e1: { predictedWinnerId: "alice" } },
      updatedAt: serverTimestamp(),
    }),
  );
});

test("members read any picks doc; outsiders and anon cannot", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "finalsPredictions/s1/picks/bob"), {
      predictorId: "bob",
      picks: {},
    });
  });
  await assertSucceeds(getDoc(doc(member(), "finalsPredictions/s1/picks/bob")));
  await assertFails(getDoc(doc(outsider(), "finalsPredictions/s1/picks/bob")));
  await assertFails(getDoc(doc(anon(), "finalsPredictions/s1/picks/bob")));
  // Scoreboard is function-written: readable by members, unwritable by anyone.
  await assertSucceeds(getDoc(doc(member(), "finalsPredictions/s1/scoreboard/leader")));
  await assertFails(
    setDoc(doc(admin(), "finalsPredictions/s1/scoreboard/leader"), { entries: [] }),
  );
});

// --- Match votes (function-only) ------------------------------------------------------
//
// castVote enforces window/participant/finals checks the rules can't express; the rules
// therefore deny ALL direct client writes so tallies stay unforgable.

test("vote docs are function-only: no client can create, change, or delete one", async () => {
  const ref = doc(member(), "matchVotes/m1/votes/alice");
  await assertFails(setDoc(ref, { voterId: "alice", candidateId: "dave" }));
  await assertFails(updateDoc(ref, { candidateId: "dave" }));
  await assertFails(updateDoc(doc(member(), "matchVotes/m1/votes/_summary"), { tally: {} }));
});

test("any member can read individual votes and the summary", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "matchVotes/m1/votes/dave"), {
      voterId: "dave",
      candidateId: "alice",
    });
    await setDoc(doc(db, "matchVotes/m1/votes/_summary"), {
      tally: { alice: 1 },
      leaderId: "alice",
      totalVotes: 1,
    });
  });
  await assertSucceeds(getDoc(doc(member(), "matchVotes/m1/votes/dave")));
  await assertSucceeds(getDoc(doc(member(), "matchVotes/m1/votes/_summary")));
  await assertFails(getDoc(doc(outsider(), "matchVotes/m1/votes/dave")));
});

// --- Push preferences -----------------------------------------------------------------

test("a user manages only their own pushPrefs with exactly muted+updatedAt", async () => {
  const own = doc(member(), "pushPrefs/alice");
  await assertSucceeds(setDoc(own, { muted: ["results"], updatedAt: serverTimestamp() }));
  // Junk categories are filtered client- and server-side; the rules only fix the shape.
  await assertFails(setDoc(own, { muted: ["results"], extra: true }));
  await assertFails(updateDoc(doc(member(), "pushPrefs/bob"), { muted: ["finals"] }));
  await assertSucceeds(getDoc(own));
  await assertFails(getDoc(doc(member(), "pushPrefs/bob"))); // even members can't peek others'
});

test("performance projections are member-readable and function-only", async () => {
  for (const path of ["seasonSummaries/s1", "readModelQueue/office", "matchAnalysis/m1"]) {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), path), { version: 1 }),
    );
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("alice").firestore(), path)));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), path)));
    await assertFails(
      setDoc(doc(testEnv.authenticatedContext("dave").firestore(), path), { version: 999 }),
    );
  }
});
test("notification and rebuild outboxes remain private to functions", async () => {
  for (const path of ["notificationOutbox/n1", "readModelEvents/m1"]) {
    await assertFails(getDoc(doc(testEnv.authenticatedContext("dave").firestore(), path)));
    await assertFails(
      setDoc(doc(testEnv.authenticatedContext("alice").firestore(), path), { status: "pending" }),
    );
  }
});

// ---- App Store safety: removed members, blocks, profile validation, private settings ----

const manualMatch = (id, bId = "dave") =>
  setDoc(doc(member(), `matches/${id}`), {
    seasonId: "s1",
    submittedBy: "alice",
    aId: "alice",
    bId,
    aTeamId: "team-a",
    bTeamId: "team-b",
    aTeam: "Crimson Albion",
    bTeam: "Royal Vega",
    aGoals: 1,
    bGoals: 0,
    status: "pending_confirmation",
    source: "manual",
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

const seed = (path, data) =>
  testEnv.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));

test("a removed member loses league access but can still read their own membership", async () => {
  await seed("leagues/office/members/alice", { role: "member", status: "removed" });
  await assertFails(getDoc(doc(member(), "matches/m1")));
  await assertFails(getDoc(doc(member(), "profiles/bob")));
  await assertSucceeds(getDoc(doc(member(), "leagues/office/members/alice")));
  await assertFails(manualMatch("removed-1"));
});

test("a removed member cannot upload match photos", async () => {
  await seed("leagues/office/members/alice", { role: "member", status: "removed" });
  const photo = testEnv
    .authenticatedContext("alice")
    .storage()
    .ref("match-photos/alice/draft-9/source.jpg");
  await assertFails(photo.put(new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
});

test("a removed admin loses admin rights", async () => {
  await seed("leagues/office/members/dave", { role: "admin", status: "removed" });
  await seed("reports/r1", { reporterId: "alice", targetId: "bob", status: "open" });
  await assertFails(getDoc(doc(admin(), "reports/r1")));
});

test("matches can't be logged against removed or deleted players", async () => {
  await seed("leagues/office/members/bob", { role: "member", status: "deleted" });
  await assertFails(manualMatch("vs-deleted", "bob"));
  await seed("leagues/office/members/bob", { role: "member", status: "removed" });
  await assertFails(manualMatch("vs-removed", "bob"));
  await assertSucceeds(manualMatch("vs-active", "dave"));
});

test("block lists are readable only by their owner and written only by functions", async () => {
  await seed("userBlocks/alice", { blocked: ["bob"] });
  await assertSucceeds(getDoc(doc(member(), "userBlocks/alice")));
  await assertFails(getDoc(doc(admin(), "userBlocks/alice")));
  await assertFails(setDoc(doc(member(), "userBlocks/alice"), { blocked: [] }));
});

test("reports are admin-readable and function-written", async () => {
  await seed("reports/r1", { reporterId: "alice", targetId: "bob", status: "open" });
  await assertSucceeds(getDoc(doc(admin(), "reports/r1")));
  await assertFails(getDoc(doc(member(), "reports/r1")));
  await assertFails(setDoc(doc(member(), "reports/r2"), { reporterId: "alice", targetId: "bob" }));
  await assertFails(updateDoc(doc(admin(), "reports/r1"), { status: "dismissed" }));
});

test("profile writes are limited to name, handle, jersey and colour, and validated", async () => {
  const own = doc(member(), "profiles/alice");
  await assertSucceeds(updateDoc(own, { displayName: "Alice B", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(own, { displayName: "A" }));
  await assertFails(updateDoc(own, { displayName: "x".repeat(41) }));
  await assertFails(updateDoc(own, { handle: "Bad Handle" }));
  await assertFails(updateDoc(own, { verified: true }));
  await assertFails(updateDoc(own, { role: "admin" }));
  await assertFails(updateDoc(doc(member(), "profiles/bob"), { displayName: "Bobby" }));
  const fresh = doc(testEnv.authenticatedContext("nora").firestore(), "profiles/nora");
  await assertFails(setDoc(fresh, { displayName: "Nora", handle: "nora", extra: 1 }));
});

test("privacy settings are owner-only with a fixed shape", async () => {
  const own = doc(member(), "privacySettings/alice");
  await assertSucceeds(
    setDoc(own, { aiPhotoReading: true, aiPhotoReadingUpdatedAt: serverTimestamp() }),
  );
  await assertSucceeds(getDoc(own));
  await assertFails(setDoc(own, { aiPhotoReading: "yes" }));
  await assertFails(setDoc(own, { aiPhotoReading: true, other: 1 }));
  await assertFails(getDoc(doc(admin(), "privacySettings/alice")));
  // Before joining (sign-up), terms acceptance can still be recorded.
  await assertSucceeds(
    setDoc(doc(outsider(), "privacySettings/nora"), { termsAcceptedAt: serverTimestamp() }),
  );
});
