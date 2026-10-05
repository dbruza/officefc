/**
 * Emulator tests for the App Store safety work: account erasure, reports, blocks, admin
 * removal and the offensive-name screen. Runs under `npm run test:rules` (Firestore and
 * Storage emulators; no Auth emulator, so deleteAccount is exercised up to the login
 * deletion and eraseUserData directly).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
initializeApp({ projectId: "demo-officefc", storageBucket: "demo-officefc.firebasestorage.app" });
const { eraseUserData, deleteAccount } = require("../lib/account");
const {
  reportPlayer,
  setPlayerBlocked,
  moderateMember,
  screenProfileName,
} = require("../lib/safety");
const { redeemInvite, getJoinOptions } = require("../lib/membership");
const { writeSeasonJoinCode } = require("../lib/utils");
const { notifyMatchSubmitted } = require("../lib/matchLifecycle");
const db = getFirestore();

const caller = (uid, token = {}) => ({ auth: { uid, token } });
const verified = (uid, email = `${uid}@office.test`) =>
  caller(uid, { email, email_verified: true });
// Params reach the runtime as environment variables, exactly as written in the .env file.
process.env.ADMIN_EMAILS = "ops@office.test, boss@office.test";

test.beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-officefc/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true);
  const batch = db.batch();
  batch.set(db.doc("leagues/office/members/a"), { role: "member", joinedAt: Timestamp.now() });
  batch.set(db.doc("leagues/office/members/b"), { role: "member" });
  batch.set(db.doc("leagues/office/members/admin"), { role: "admin" });
  batch.set(db.doc("profiles/a"), { displayName: "Alice Smith", handle: "alice", jersey: 7 });
  batch.set(db.doc("profiles/b"), { displayName: "Bob", handle: "bob", jersey: 9 });
  await batch.commit();
});
test.after(async () => {
  await db.terminate();
});

test("account erasure removes personal data but keeps opponents' history", async () => {
  const batch = db.batch();
  batch.set(db.doc("matches/pending"), {
    aId: "a",
    bId: "b",
    submittedBy: "a",
    status: "pending_confirmation",
    aGoals: 2,
    bGoals: 1,
    photoPath: "match-photos/a/pending/source.jpg",
  });
  batch.set(db.doc("matches/played"), {
    aId: "b",
    bId: "a",
    submittedBy: "b",
    status: "confirmed",
    aGoals: 0,
    bGoals: 3,
  });
  batch.set(db.doc("matchAnalysis/played"), { headline: "Alice wins" });
  batch.set(db.doc("matchDrafts/d1"), { ownerUid: "a", storagePath: "match-photos/a/d1/x.jpg" });
  batch.set(db.doc("pushPrefs/a"), { muted: [] });
  batch.set(db.doc("privacySettings/a"), { aiPhotoReading: true });
  batch.set(db.doc("userBlocks/a"), { blocked: ["b"] });
  batch.set(db.doc("deviceTokens/a/tokens/t1"), { expoPushToken: "ExponentPushToken[x]" });
  batch.set(db.doc("reports/r1"), { reporterId: "a", targetId: "b", details: "mean" });
  batch.set(db.doc("notificationOutbox/n1"), { uid: "a", body: "hi" });
  batch.set(db.doc("notificationOutbox/n2"), { uid: "b", body: "keep" });
  await batch.commit();

  await eraseUserData("a");

  const profile = (await db.doc("profiles/a").get()).data();
  assert.equal(profile.displayName, "Deleted player");
  assert.equal(profile.handle, "deleted");
  const member = (await db.doc("leagues/office/members/a").get()).data();
  assert.equal(member.status, "deleted");
  assert.equal(member.role, "member");
  assert.equal("viaCode" in member, false);

  const pending = (await db.doc("matches/pending").get()).data();
  assert.equal(pending.status, "voided");
  assert.equal(pending.photoPath, undefined);
  const played = (await db.doc("matches/played").get()).data();
  assert.equal(played.status, "confirmed");
  assert.equal(played.bGoals, 3);

  for (const path of [
    "matchAnalysis/played",
    "matchDrafts/d1",
    "pushPrefs/a",
    "privacySettings/a",
    "userBlocks/a",
    "deviceTokens/a/tokens/t1",
    "reports/r1",
    "notificationOutbox/n1",
  ])
    assert.equal((await db.doc(path).get()).exists, false, path);
  assert.equal((await db.doc("notificationOutbox/n2").get()).exists, true);

  // Re-running after a partial failure is safe.
  await eraseUserData("a");
});

test("someone who never joined has their profile removed outright", async () => {
  await db.doc("profiles/n").set({ displayName: "Nora", handle: "nora" });
  await eraseUserData("n");
  assert.equal((await db.doc("profiles/n").get()).exists, false);
  assert.equal((await db.doc("leagues/office/members/n").get()).exists, false);
});

test("deleteAccount refuses a stale sign-in before touching anything", async () => {
  const stale = Math.floor(Date.now() / 1000) - 3600;
  await assert.rejects(
    deleteAccount.run({ ...caller("a", { auth_time: stale }), data: {} }),
    /password again/,
  );
  assert.equal((await db.doc("profiles/a").get()).get("displayName"), "Alice Smith");
});

test("blocking files a report, and a blocked pair's new match is voided without a push", async () => {
  await setPlayerBlocked.run({ ...caller("b"), data: { targetUid: "a", blocked: true } });
  assert.deepEqual((await db.doc("userBlocks/b").get()).get("blocked"), ["a"]);
  const reports = await db.collection("reports").where("targetId", "==", "a").get();
  assert.equal(reports.size, 1);
  assert.equal(reports.docs[0].get("source"), "block");

  const ref = db.doc("matches/blocked");
  await ref.set({
    aId: "a",
    bId: "b",
    submittedBy: "a",
    status: "pending_confirmation",
    aGoals: 1,
    bGoals: 0,
  });
  const outboxBefore = (await db.collection("notificationOutbox").where("uid", "==", "b").get())
    .size;
  await notifyMatchSubmitted.run({ data: await ref.get(), params: { matchId: "blocked" } });
  assert.equal((await ref.get()).get("status"), "voided");
  const outboxAfter = (await db.collection("notificationOutbox").where("uid", "==", "b").get())
    .size;
  assert.equal(outboxAfter, outboxBefore);

  await setPlayerBlocked.run({ ...caller("b"), data: { targetUid: "a", blocked: false } });
  assert.deepEqual((await db.doc("userBlocks/b").get()).get("blocked"), []);

  // Blocking again doesn't page the admins a second time.
  await setPlayerBlocked.run({ ...caller("b"), data: { targetUid: "a", blocked: true } });
  assert.equal((await db.collection("reports").where("targetId", "==", "a").get()).size, 1);
});

test("reports validate their reason and reach the admins", async () => {
  await assert.rejects(
    reportPlayer.run({ ...caller("a"), data: { targetUid: "b", reason: "spam" } }),
    /reason/,
  );
  await assert.rejects(
    reportPlayer.run({ ...caller("a"), data: { targetUid: "a", reason: "other" } }),
    /yourself/,
  );
  await reportPlayer.run({
    ...caller("a"),
    data: { targetUid: "b", reason: "offensive_name", details: "x".repeat(900) },
  });
  const report = (await db.collection("reports").get()).docs[0].data();
  assert.equal(report.status, "open");
  assert.equal(report.details.length, 500);
  const pushes = await db.collection("notificationOutbox").where("uid", "==", "admin").get();
  assert.equal(pushes.size, 1);
  assert.equal(pushes.docs[0].get("data").type, "report");
});

test("a removed member is locked out and can't rejoin with a code until reinstated", async () => {
  await assert.rejects(
    moderateMember.run({ ...caller("a"), data: { targetUid: "b", action: "remove" } }),
    /Admins only/,
  );
  await moderateMember.run({ ...caller("admin"), data: { targetUid: "b", action: "remove" } });
  assert.equal((await db.doc("leagues/office/members/b").get()).get("status"), "removed");
  await assert.rejects(
    redeemInvite.run({ ...caller("b"), data: { code: "OFC-ABCDE" } }),
    /removed from this league/,
  );
  await assert.rejects(
    reportPlayer.run({ ...caller("b"), data: { targetUid: "a", reason: "other" } }),
    /members only/,
  );

  await moderateMember.run({ ...caller("admin"), data: { targetUid: "b", action: "reinstate" } });
  assert.equal((await db.doc("leagues/office/members/b").get()).get("status"), undefined);
});

test("an offensive name written straight to Firestore is replaced and reported", async () => {
  const ref = db.doc("profiles/a");
  await ref.update({ displayName: "Big Fucker" });
  await screenProfileName.run({ data: { after: await ref.get() }, params: { uid: "a" } });
  const profile = (await ref.get()).data();
  assert.equal(profile.displayName, "Player 7");
  assert.equal(profile.handle, "player7");
  const reports = await db.collection("reports").where("targetId", "==", "a").get();
  assert.equal(reports.docs[0].get("source"), "auto");

  // A clean name is left alone.
  await ref.update({ displayName: "Alice Again" });
  await screenProfileName.run({ data: { after: await ref.get() }, params: { uid: "a" } });
  assert.equal((await ref.get()).get("displayName"), "Alice Again");

  // Re-saving an offensive name is replaced again but adds no report while one is open.
  await ref.update({ displayName: "Big Fucker" });
  await screenProfileName.run({ data: { after: await ref.get() }, params: { uid: "a" } });
  assert.equal((await ref.get()).get("displayName"), "Player 7");
  assert.equal((await db.collection("reports").where("targetId", "==", "a").get()).size, 1);

  // A non-member's offensive name is replaced, and the admins aren't paged about it.
  const stranger = db.doc("profiles/stranger");
  await stranger.set({ displayName: "Big Fucker", handle: "x", jersey: 3 });
  await screenProfileName.run({
    data: { after: await stranger.get() },
    params: { uid: "stranger" },
  });
  assert.equal((await stranger.get()).get("displayName"), "Player 3");
  assert.equal((await db.collection("reports").where("targetId", "==", "stranger").get()).size, 0);
});

test("an allowlisted email only makes an admin once it's verified", async () => {
  // Anyone can register an allowlisted address nobody has claimed yet; they can't verify it.
  const squatter = caller("mallory", { email: "Boss@office.test", email_verified: false });
  await assert.rejects(redeemInvite.run({ ...squatter, data: { code: "" } }), /Verify your email/);
  assert.equal((await db.doc("leagues/office/members/mallory").get()).exists, false);
  assert.deepEqual(await getJoinOptions.run(squatter), { adminSetup: false });

  assert.deepEqual(await getJoinOptions.run(verified("boss", "Boss@office.test")), {
    adminSetup: true,
  });
  assert.deepEqual(await getJoinOptions.run(verified("c")), { adminSetup: false });
});

test("joining records the season rather than the code, and wrong codes run out", async () => {
  await db.doc("seasons/s1").set({ name: "S1", active: true, finalized: false });
  await writeSeasonJoinCode("s1", "OFC-GOODX");

  await redeemInvite.run({ ...verified("c"), data: { code: "OFC-GOODX" } });
  const member = (await db.doc("leagues/office/members/c").get()).data();
  assert.equal(member.viaSeason, "s1");
  assert.equal("viaCode" in member, false, "members can read member docs, so no codes there");

  for (let i = 0; i < 10; i++)
    await assert.rejects(
      redeemInvite.run({ ...verified("d"), data: { code: `OFC-BAD${i}` } }),
      /not found/,
    );
  await assert.rejects(
    redeemInvite.run({ ...verified("d"), data: { code: "OFC-GOODX" } }),
    /Too many incorrect join codes/,
  );
});

test("blocking someone who isn't in the league is refused", async () => {
  await assert.rejects(
    setPlayerBlocked.run({ ...caller("a"), data: { targetUid: "ghost", blocked: true } }),
    /Player not found/,
  );
});
