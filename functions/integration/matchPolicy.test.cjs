/**
 * Emulator tests for the match-submission policy: the 24-hour auto-confirm window that only
 * runs while the opponent can be notified, the pending-result limits notifyMatchSubmitted
 * enforces, and admins voiding a result that was already confirmed. Runs under
 * `npm run test:rules` (Firestore and Storage emulators).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
initializeApp({ projectId: "demo-officefc", storageBucket: "demo-officefc.firebasestorage.app" });
const { schedulePendingMatch } = require("../lib/scheduling");
const { notifyMatchSubmitted, pendingLimitMessage } = require("../lib/matchLifecycle");
const { autoConfirmStaleMatches, sendReminders } = require("../lib/scheduled");
const { resolveMatch } = require("../lib/seasonAdmin");
const { drainRebuildQueue, requestRebuild } = require("../lib/rebuildQueue");
const { toStoredRounds } = require("../lib/cupRules");
const policy = require("../lib/models/matchPolicy");
const db = getFirestore();

const HOUR = 60 * 60 * 1000;
const caller = (uid) => ({ auth: { uid, token: {} } });

test.beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-officefc/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true);
  const batch = db.batch();
  for (const uid of ["a", "b", "c", "d"]) {
    batch.set(db.doc(`leagues/office/members/${uid}`), { role: "member" });
    batch.set(db.doc(`profiles/${uid}`), { displayName: uid.toUpperCase(), handle: uid });
  }
  batch.set(db.doc("leagues/office/members/admin"), { role: "admin" });
  // a and b play on phones; c only uses the web app (no push device); d has a phone but
  // muted confirmations.
  for (const uid of ["a", "b", "d"])
    batch.set(db.doc(`deviceTokens/${uid}/tokens/t1`), {
      expoPushToken: `ExponentPushToken[${uid}]`,
    });
  batch.set(db.doc("pushPrefs/d"), { muted: ["confirmations"] });
  batch.set(db.doc("seasons/s1"), {
    active: true,
    finalized: false,
    start: Timestamp.fromMillis(1690000000000),
  });
  for (const [id, name] of [
    ["t1", "Team A"],
    ["t2", "Team B"],
  ])
    batch.set(db.doc(`teams/${id}`), { name, overall: 80, active: true });
  batch.set(db.doc("teamCatalogues/current"), {
    teams: [
      { id: "t1", name: "Team A", overall: 80, competition: "Test" },
      { id: "t2", name: "Team B", overall: 80, competition: "Test" },
    ],
  });
  // Auto-confirm has long been live, and legacy scheduling is migrated.
  batch.set(db.doc("systemState/autoConfirm"), { armedAt: 0 });
  batch.set(db.doc("systemState/performanceScheduling"), { complete: true });
  await batch.commit();
});
test.after(async () => {
  await db.terminate();
});

const matchFields = (submittedBy, opponent, created) => ({
  seasonId: "s1",
  submittedBy,
  aId: submittedBy,
  bId: opponent,
  aTeamId: "t1",
  bTeamId: "t2",
  aTeam: "Team A",
  bTeam: "Team B",
  aGoals: 3,
  bGoals: 1,
  source: "manual",
  date: created,
  createdAt: created,
});

/** A pending result `a` submitted against `opponent`, `ageHours` ago. */
async function pendingMatch(id, { opponent = "b", ageHours = 0 } = {}) {
  const ref = db.doc(`matches/${id}`);
  const created = Timestamp.fromMillis(Date.now() - ageHours * HOUR);
  await ref.set({ ...matchFields("a", opponent, created), status: "pending_confirmation" });
  return ref;
}

const submitted = async (ref) =>
  notifyMatchSubmitted.run({ data: await ref.get(), params: { matchId: ref.id } });

/** Move a pending match's auto-confirm time to `hours` after it was created. */
async function dueAfter(ref, hours) {
  const created = (await ref.get()).get("createdAt").toMillis();
  await ref.update({ autoConfirmDueAt: Timestamp.fromMillis(created + hours * HOUR) });
}

const outbox = async () =>
  (await db.collection("notificationOutbox").get()).docs.map((d) => d.data());

test("only a result whose opponent can be notified goes on the 24-hour clock", async () => {
  const toPhone = await pendingMatch("to-phone");
  const toWeb = await pendingMatch("to-web", { opponent: "c" });
  const toMuted = await pendingMatch("to-muted", { opponent: "d" });
  for (const ref of [toPhone, toWeb, toMuted]) await schedulePendingMatch(ref);

  const phone = (await toPhone.get()).data();
  assert.equal(phone.autoConfirmDueAt.toMillis(), phone.createdAt.toMillis() + 24 * HOUR);
  assert.equal(phone.reminderDueAt.toMillis(), phone.createdAt.toMillis() + 20 * HOUR);
  assert.equal(phone.autoConfirmHold, undefined);
  for (const ref of [toWeb, toMuted]) {
    const held = (await ref.get()).data();
    assert.equal(held.autoConfirmDueAt, null, ref.id);
    // Generic on purpose: match docs are member-readable, push preferences are private.
    assert.equal(held.autoConfirmHold, policy.AUTO_CONFIRM_HOLD, ref.id);
    assert.ok(held.reminderDueAt, ref.id);
  }

  // Stamped once: installing the app later doesn't put a result that was never pushed back on
  // the clock.
  await db.doc("deviceTokens/c/tokens/t1").set({ expoPushToken: "ExponentPushToken[c]" });
  await schedulePendingMatch(toWeb);
  assert.equal((await toWeb.get()).get("autoConfirmDueAt"), null);
});

test("the scheduler confirms after 24 hours, holds for an opponent who went quiet, and re-dates 1-hour stamps", async () => {
  const due = await pendingMatch("due", { ageHours: 25 });
  await dueAfter(due, 24);
  // Stamped under the old 1-hour window: due by that rule, not by today's.
  const legacy = await pendingMatch("legacy", { ageHours: 2 });
  await dueAfter(legacy, 1);
  // Also 1-hour-stamped, but old enough that the stamp sits below the due query's age floor.
  const oldLegacy = await pendingMatch("old-legacy", { ageHours: 60 });
  await dueAfter(oldLegacy, 1);
  // Put on the clock while d could be notified; d has since muted confirmations.
  const quiet = await pendingMatch("quiet", { opponent: "d", ageHours: 25 });
  await dueAfter(quiet, 24);
  // Still inside the window.
  const recent = await pendingMatch("recent", { ageHours: 23 });
  await dueAfter(recent, 24);

  await autoConfirmStaleMatches.run({});

  const confirmed = (await due.get()).data();
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedBy, "auto");
  assert.equal((await db.doc("readModelEvents/due").get()).get("mode"), "auto");

  const redated = (await legacy.get()).data();
  assert.equal(redated.status, "pending_confirmation");
  assert.equal(redated.autoConfirmDueAt.toMillis(), redated.createdAt.toMillis() + 24 * HOUR);
  // Still inside the 72-hour age limit, so once re-dated it is due like any other.
  assert.equal((await oldLegacy.get()).get("status"), "confirmed");
  const migration = (await db.doc("systemState/autoConfirmWindow").get()).data();
  assert.equal(migration.hours, policy.AUTO_CONFIRM_HOURS);
  assert.equal(migration.complete, true);

  const held = (await quiet.get()).data();
  assert.equal(held.status, "pending_confirmation");
  assert.equal(held.autoConfirmDueAt, null);
  assert.equal(held.autoConfirmHold, policy.AUTO_CONFIRM_HOLD);

  assert.equal((await recent.get()).get("status"), "pending_confirmation");

  // Nothing changes on the next run: the held and re-dated matches are off the due list.
  await autoConfirmStaleMatches.run({});
  assert.equal((await quiet.get()).get("status"), "pending_confirmation");
  assert.equal((await legacy.get()).get("status"), "pending_confirmation");
});

test("reminders only promise a lock-in when the result is on the clock", async () => {
  const onClock = await pendingMatch("on-clock", { ageHours: 21 });
  const waiting = await pendingMatch("waiting", { opponent: "c", ageHours: 21 });
  for (const ref of [onClock, waiting]) await schedulePendingMatch(ref);

  await sendReminders.run({});

  const rows = await outbox();
  const forB = rows.find((row) => row.uid === "b" && row.data.matchId === "on-clock");
  assert.match(forB.body, /confirms automatically 24h after it was submitted/);
  const forC = rows.find((row) => row.uid === "c" && row.data.matchId === "waiting");
  assert.doesNotMatch(forC.body, /automatically/);
  assert.ok((await onClock.get()).get("reminderSentAt"));
});

test("past the per-opponent limit the newest result is voided, whatever order triggers run", async () => {
  const refs = [];
  for (let i = 0; i <= policy.MAX_PENDING_PER_OPPONENT; i++)
    refs.push(await pendingMatch(`vs-b-${i}`, { ageHours: 1 - i / 100 }));
  for (const ref of [...refs].reverse()) await submitted(ref);

  const statuses = await Promise.all(refs.map(async (ref) => (await ref.get()).get("status")));
  assert.deepEqual(statuses, [
    ...Array(policy.MAX_PENDING_PER_OPPONENT).fill("pending_confirmation"),
    "voided",
  ]);
  const voided = (await refs.at(-1).get()).data();
  assert.equal(voided.resolvedBy, "system");
  assert.equal(voided.resolutionReason, policy.PENDING_LIMIT_MESSAGES.opponent);
  assert.equal(voided.autoConfirmDueAt, undefined);
  // b hears about the results that count, never the excess one.
  const pushes = (await outbox()).filter((row) => row.uid === "b");
  assert.equal(pushes.length, policy.MAX_PENDING_PER_OPPONENT);
  assert.equal(
    pushes.some((row) => row.data.matchId === refs.at(-1).id),
    false,
  );

  // The limit is per opponent.
  const toC = await pendingMatch("vs-c", { opponent: "c" });
  await submitted(toC);
  assert.equal((await toC.get()).get("status"), "pending_confirmation");

  // A late or retried trigger never voids a result that was answered in the meantime.
  const late = await pendingMatch("vs-b-late");
  const asCreated = await late.get();
  await late.update({ status: "confirmed" });
  await notifyMatchSubmitted.run({ data: asCreated, params: { matchId: late.id } });
  assert.equal((await late.get()).get("status"), "confirmed");
});

test("a player can't have more than 20 results waiting, whoever they're against", async () => {
  const opponents = ["b", "c", "d"];
  for (let i = 0; i < policy.MAX_PENDING_PER_SUBMITTER; i++)
    await pendingMatch(`m${i}`, { opponent: opponents[i % 3], ageHours: 2 - i / 100 });
  // Callables that write matches themselves refuse up front with the same message.
  assert.equal(await pendingLimitMessage("a", "c"), policy.PENDING_LIMIT_MESSAGES.submitter);

  const extra = await pendingMatch("extra", { opponent: "c" });
  await submitted(extra);
  assert.equal((await extra.get()).get("status"), "voided");
  assert.equal(
    (await extra.get()).get("resolutionReason"),
    policy.PENDING_LIMIT_MESSAGES.submitter,
  );

  // Once an opponent answers one, there's room again.
  await db.doc("matches/m0").update({ status: "confirmed" });
  assert.equal(await pendingLimitMessage("a", "c"), null);
  const next = await pendingMatch("next", { opponent: "c" });
  await submitted(next);
  assert.equal((await next.get()).get("status"), "pending_confirmation");
});

const confirmedResult = (aGoals) => ({
  seasonId: "s1",
  aId: "a",
  bId: "b",
  aGoals,
  bGoals: 1,
  submittedBy: "a",
  finals: false,
  finalsSlot: null,
  decidedBy: null,
});

/** A result confirmed (as auto-confirm would) and published to the tables. */
async function confirmedMatch(id, aGoals = 3, minute = 1) {
  const ref = db.doc(`matches/${id}`);
  const created = Timestamp.fromMillis(1700000000000 + minute * 60000);
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      ...matchFields("a", "b", created),
      aGoals,
      status: "confirmed",
      confirmedBy: "auto",
      confirmedAt: created,
    });
    requestRebuild(tx, "s1", { matchId: id, result: confirmedResult(aGoals), mode: "auto" });
  });
  await drainRebuildQueue();
  return ref;
}

const voidRequest = (matchId, reason, uid = "admin") =>
  resolveMatch.run({ ...caller(uid), data: { matchId, action: "void", reason } });

test("an admin can void a confirmed result: it leaves the tables and an audit record stays", async () => {
  const forged = await confirmedMatch("forged", 99, 1);
  // A later draw, rated with the forged result already in the table.
  const genuine = await confirmedMatch("genuine", 1, 2);
  assert.equal((await db.doc("playerStats/a").get()).get("games"), 2);
  assert.equal((await db.doc("seasons/s1/standings/a").get()).get("w"), 1);
  assert.ok((await db.doc("activity/result_forged").get()).exists);
  assert.equal(typeof (await forged.get()).get("aDelta"), "number");
  const feedBefore = (await db.doc("activity/result_genuine").get()).data();
  assert.equal(feedBefore.payload.aDelta, (await genuine.get()).get("aDelta"));

  await assert.rejects(voidRequest("forged", "Never played", "a"), /Admins only/);
  await assert.rejects(voidRequest("forged", "  "), /Give a reason/);
  await assert.rejects(
    resolveMatch.run({ ...caller("admin"), data: { matchId: "forged", action: "confirm" } }),
    /Already confirmed/,
  );

  const response = await voidRequest("forged", "Never played — the score was forged.");
  assert.deepEqual(response, { ok: true, matchId: "forged", cupTieMayNeedRepair: false });

  const voided = (await forged.get()).data();
  assert.equal(voided.status, "voided");
  assert.equal(voided.resolvedBy, "admin");
  assert.equal(voided.previousStatus, "confirmed");
  assert.equal(voided.resolutionReason, "Never played — the score was forged.");
  for (const field of ["aDelta", "bDelta", "aEloAfter", "eloExplain"])
    assert.equal(voided[field], undefined, field);

  const audit = await db.collection("matchAudit").where("matchId", "==", "forged").get();
  assert.equal(audit.size, 1);
  const entry = audit.docs[0].data();
  assert.equal(entry.action, "void_confirmed");
  assert.equal(entry.adminId, "admin");
  assert.equal(entry.confirmedBy, "auto");
  assert.equal(entry.aGoals, 99);
  assert.equal(typeof entry.aDelta, "number");
  assert.ok(entry.createdAt);

  assert.equal((await db.doc("activity/result_forged").get()).exists, false);
  assert.ok((await db.doc("activity/result_genuine").get()).exists);
  const told = (await outbox())
    .filter((row) => row.data.type === "match_voided")
    .map((row) => row.uid)
    .sort();
  assert.deepEqual(told, ["a", "b"]);

  // The normal rebuild takes it out of the ratings, table and stats...
  await drainRebuildQueue();
  assert.equal((await db.doc("playerStats/a").get()).get("games"), 1);
  assert.equal((await db.doc("seasons/s1/standings/a").get()).get("w"), 0);
  assert.equal((await db.doc("readModelEvents/forged").get()).get("status"), "done");
  // ...and the later result's feed entry is re-derived from its new rating move, in place.
  const rerated = (await genuine.get()).get("aDelta");
  assert.notEqual(rerated, feedBefore.payload.aDelta);
  const feedAfter = (await db.doc("activity/result_genuine").get()).data();
  assert.equal(feedAfter.payload.aDelta, rerated);
  assert.equal(feedAfter.createdAt.toMillis(), feedBefore.createdAt.toMillis());

  await assert.rejects(voidRequest("forged", "again"), /Already voided/);
});

test("voiding a confirmed result is refused where it can't be undone cleanly", async () => {
  // Its confirmation work hasn't run yet.
  await db.runTransaction(async (tx) => {
    tx.set(db.doc("matches/queued"), {
      ...matchFields("a", "b", Timestamp.now()),
      status: "confirmed",
      confirmedBy: "b",
    });
    requestRebuild(tx, "s1", { matchId: "queued", result: confirmedResult(3), mode: "manual" });
  });
  await assert.rejects(voidRequest("queued", "typo"), /still being added/);
  await drainRebuildQueue();

  // Finals already advanced the bracket.
  await db.doc("matches/final").set({
    ...matchFields("a", "b", Timestamp.now()),
    status: "confirmed",
    finals: true,
    finalsSlot: "gf",
  });
  await assert.rejects(voidRequest("final", "typo"), /Finals results/);

  // A finalized season's results are published.
  await db.doc("seasons/s1").update({ finalized: true });
  await assert.rejects(voidRequest("queued", "typo"), /finalized/);
  assert.equal((await db.doc("matches/queued").get()).get("status"), "confirmed");
  assert.equal((await db.collection("matchAudit").get()).size, 0);
});

test("voiding a result between a pair whose cup tie is decided flags the bracket", async () => {
  await db.doc("seasons/s1/cup/state").set({
    status: "live",
    rounds: toStoredRounds([
      [
        { aId: "a", bId: "b", winnerId: null },
        { aId: "c", bId: "d", winnerId: null },
      ],
      [{ aId: null, bId: null, winnerId: null }],
    ]),
  });
  await confirmedMatch("cup-decider");
  assert.equal((await db.doc("seasons/s1/cup/state").get()).get("rounds")[0].ties[0].winnerId, "a");

  const response = await voidRequest("cup-decider", "Played with the wrong teams");
  assert.equal(response.cupTieMayNeedRepair, true);
  const audit = await db.collection("matchAudit").where("matchId", "==", "cup-decider").get();
  assert.equal(audit.docs[0].get("cupTieMayNeedRepair"), true);
});

test("the photo callable refuses a new result over the limit but still answers a retry", async () => {
  const { submitAiAssistedMatch } = require("../lib/extract/submitAiAssistedMatch");
  const opponents = ["b", "c", "d"];
  for (let i = 0; i < policy.MAX_PENDING_PER_SUBMITTER; i++)
    await pendingMatch(`m${i}`, { opponent: opponents[i % 3], ageHours: 2 - i / 100 });
  // A photo result written earlier and confirmed since, so it's no longer among the pending.
  await db.doc("matchDrafts/sent").set({
    ownerUid: "a",
    status: "done",
    submitted: true,
    submittedMatchId: "sent",
  });
  await db.doc("matches/sent").set({
    ...matchFields("a", "b", Timestamp.now()),
    source: "ai_assisted",
    status: "confirmed",
  });
  await db.doc("matchDrafts/fresh").set({ ownerUid: "a", status: "done", submitted: false });
  const submit = (draftId) =>
    submitAiAssistedMatch.run({
      ...caller("a"),
      data: {
        draftId,
        seasonId: "s1",
        opponentId: "b",
        mySide: "home",
        myTeamId: "t1",
        opponentTeamId: "t2",
        submittedGoalsAndStats: { myGoals: 2, opponentGoals: 1 },
      },
    });

  assert.deepEqual(await submit("sent"), { ok: true, matchId: "sent" });
  await assert.rejects(
    submit("fresh"),
    (error) => error.message === policy.PENDING_LIMIT_MESSAGES.submitter,
  );
  assert.equal((await db.doc("matches/fresh").get()).exists, false);
});
