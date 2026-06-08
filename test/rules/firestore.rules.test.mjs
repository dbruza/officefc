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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(here, "../../firestore.rules"), "utf8");
const storageRules = readFileSync(join(here, "../../storage.rules"), "utf8");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    // Match the emulator CLI project so Storage's firestore.exists() cross-service
    // lookup reads the same Firestore namespace seeded below.
    projectId: "office-fc",
    firestore: { rules, host: "127.0.0.1", port: 8080 },
    storage: { rules: storageRules, host: "127.0.0.1", port: 12199 },
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
    await setDoc(doc(db, "invites/OFC-ABCDE"), { role: "member", usedBy: null });
  });
});

const member = () => testEnv.authenticatedContext("alice").firestore();
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

test("non-members cannot read M3 aggregate documents", async () => {
  await assertFails(getDoc(doc(outsider(), "playerStats/alice")));
  await assertFails(getDoc(doc(outsider(), "h2h/alice__dave")));
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
