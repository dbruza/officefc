const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
initializeApp({ projectId: "demo-officefc", storageBucket: "demo-officefc.firebasestorage.app" });
const {
  enqueueRebuild,
  drainRebuildQueue,
  requestRebuild,
  modelVersion,
} = require("../lib/rebuildQueue");
const { ModelWriter, QUEUE_PATH } = require("../lib/modelWriter");
const { calculateSeason } = require("../lib/elo");
const db = getFirestore();
const result = {
  seasonId: "s1",
  aId: "a",
  bId: "b",
  aGoals: 3,
  bGoals: 1,
  submittedBy: "a",
  finals: false,
  finalsSlot: null,
  decidedBy: null,
};
async function seedMatch(id, minute, score = 3) {
  const ref = db.doc(`matches/${id}`);
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      ...result,
      aGoals: score,
      status: "confirmed",
      source: "manual",
      aTeamId: "t1",
      bTeamId: "t2",
      aTeam: "Team A",
      bTeam: "Team B",
      date: Timestamp.fromMillis(1700000000000 + minute * 60000),
    });
    requestRebuild(tx, "s1", { matchId: id, result: { ...result, aGoals: score }, mode: "manual" });
  });
}
test.beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-officefc/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true);
  const batch = db.batch();
  for (const uid of ["a", "b"])
    batch.set(db.doc(`leagues/office/members/${uid}`), { role: "member" });
  for (const uid of ["a", "b"]) batch.set(db.doc(`profiles/${uid}`), { displayName: uid });
  batch.set(db.doc("seasons/s1"), { active: true, start: Timestamp.fromMillis(1690000000000) });
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
  await batch.commit();
});
test.after(async () => {
  await db.terminate();
});
test("confirmed work is durable, concurrent drains serialize, and no-op replay does not rewrite matches", async () => {
  await seedMatch("m1", 1);
  await assert.rejects(modelVersion(), /updating/);
  const drains = await Promise.all([drainRebuildQueue(), drainRebuildQueue()]);
  assert.equal(drains.filter(Boolean).length, 1);
  const first = await db.doc("matches/m1").get();
  assert.equal((await db.doc("playerStats/a").get()).get("summary.matchCount"), 1);
  assert.equal((await db.doc("seasonSummaries/s1").get()).get("matchCount"), 1);
  assert.equal((await db.doc("readModelEvents/m1").get()).get("status"), "done");
  assert.equal((await db.collection("notificationOutbox").get()).size, 1);
  await enqueueRebuild("s1");
  await drainRebuildQueue();
  assert.equal(
    (await db.doc("matches/m1").get()).updateTime.toMillis(),
    first.updateTime.toMillis(),
  );
  await modelVersion();
});
test("out-of-order confirmations replay deterministically and keep full profile summaries", async () => {
  await seedMatch("later", 2, 1);
  await drainRebuildQueue();
  await seedMatch("earlier", 1, 4);
  await drainRebuildQueue();
  const expected = calculateSeason(
    [
      {
        ...result,
        id: "earlier",
        aGoals: 4,
        dateMillis: 1700000060000,
        aTeamOverall: 80,
        bTeamOverall: 80,
      },
      {
        ...result,
        id: "later",
        aGoals: 1,
        dateMillis: 1700000120000,
        aTeamOverall: 80,
        bTeamOverall: 80,
      },
    ],
    ["a", "b"],
    1690000000000,
  );
  assert.equal(
    (await db.doc("seasons/s1/standings/a").get()).get("elo"),
    expected.standings.find((p) => p.uid === "a").elo,
  );
  const stats = await db.doc("playerStats/a").get();
  assert.equal(stats.get("summary.facts.maxGoals"), 4);
  assert.equal(stats.get("summary").teams[0].games, 2);
});
test("an expired worker cannot overwrite a newer generation", async () => {
  await db.doc(QUEUE_PATH).set({ leaseToken: "new", leaseUntil: Date.now() + 60000 });
  const writer = new ModelWriter({ token: "old" });
  writer.set(db.doc("playerStats/a"), { games: 999 });
  await assert.rejects(writer.close(), /lease/);
  assert.equal((await db.doc("playerStats/a").get()).exists, false);
});
test("summary backfills preserve frozen ratings unless an admin requests replay", async () => {
  await seedMatch("m1", 1);
  await drainRebuildQueue();
  await db.doc("seasons/s1").update({ finalized: true });
  await db.doc("matches/m1").update({ aDelta: 777 });
  await enqueueRebuild("s1");
  await drainRebuildQueue();
  assert.equal((await db.doc("matches/m1").get()).get("aDelta"), 777);
  await enqueueRebuild("s1", true);
  await drainRebuildQueue();
  assert.notEqual((await db.doc("matches/m1").get()).get("aDelta"), 777);
});

test("a worker crash after partial publication leaves durable work for recovery", async () => {
  await seedMatch("m1", 1);
  const close = ModelWriter.prototype.close;
  let fail = true;
  ModelWriter.prototype.close = async function () {
    await close.call(this);
    if (fail) {
      fail = false;
      throw new Error("simulated worker crash");
    }
  };
  try {
    await assert.rejects(drainRebuildQueue(), /simulated worker crash/);
  } finally {
    ModelWriter.prototype.close = close;
  }
  await assert.rejects(modelVersion(), /updating/);
  assert.equal((await db.doc("readModelEvents/m1").get()).get("status"), "pending");
  assert.equal(await drainRebuildQueue(), true);
  await modelVersion();
  assert.equal((await db.doc("playerStats/a").get()).get("games"), 1);
});
test("a confirmation arriving during publication is not lost when the older worker completes", async () => {
  await seedMatch("m1", 1);
  const close = ModelWriter.prototype.close;
  let release, entered;
  const paused = new Promise((resolve) => {
    entered = resolve;
  });
  const resume = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  ModelWriter.prototype.close = async function () {
    if (first) {
      first = false;
      entered();
      await resume;
    }
    return close.call(this);
  };
  try {
    const running = drainRebuildQueue();
    await paused;
    await seedMatch("m2", 2);
    release();
    await running;
  } finally {
    release();
    ModelWriter.prototype.close = close;
  }
  await assert.rejects(modelVersion(), /updating/);
  await drainRebuildQueue();
  await modelVersion();
  assert.equal((await db.doc("seasons/s1/standings/a").get()).get("w"), 2);
  assert.equal((await db.doc("readModelEvents/m2").get()).get("status"), "done");
});

test("analysis reads current bounded summaries without fabricating a pre-match record", async () => {
  await seedMatch("m1", 1);
  await seedMatch("m2", 2);
  await drainRebuildQueue();
  await db
    .doc("matchVotes/m2/votes/_summary")
    .set({ leaderId: null, totalVotes: 2, tally: { a: 1, b: 1 } });
  const { gatherAnalysisContext } = require("../lib/matchAnalysis/analyzeMatch");
  const match = (await db.doc("matches/m2").get()).data();
  const context = await gatherAnalysisContext("m2", {
    ...match,
    aId: "b",
    bId: "a",
    aGoals: 1,
    bGoals: 3,
  });
  assert.equal(context.headToHead.games, 2);
  assert.equal(context.headToHead.aWins, 0);
  assert.equal(context.headToHead.bWins, 2);
  assert.equal(context.headToHead.recent[0].score, "1-3");
  assert.equal(context.mvpSide, null);
  assert.deepEqual(Object.keys(context.seasonForm).sort(), ["a", "b"]);
});

test("the callable authorizes the opponent and atomically records work before returning", async () => {
  const { confirmMatch } = require("../lib/matchLifecycle");
  await db.doc("matches/pending").set({
    ...result,
    status: "pending_confirmation",
    aTeamId: "t1",
    bTeamId: "t2",
    aTeam: "Team A",
    bTeam: "Team B",
    date: Timestamp.now(),
  });
  await assert.rejects(
    confirmMatch.run({ auth: { uid: "a", token: {} }, data: { matchId: "pending" } }),
    /opponent/,
  );
  assert.equal((await db.doc(QUEUE_PATH).get()).exists, false);
  const accepted = await confirmMatch.run({
    auth: { uid: "b", token: {} },
    data: { matchId: "pending" },
  });
  assert.equal(accepted.updating, true);
  assert.equal((await db.doc("matches/pending").get()).get("status"), "confirmed");
  assert.equal((await db.doc("readModelEvents/pending").get()).get("status"), "pending");
  assert.equal((await db.doc("playerStats/a").get()).exists, false);
  await drainRebuildQueue();
  assert.equal((await db.doc("playerStats/a").get()).get("games"), 1);
});
test("fresh fixture deals wait for current ratings while an existing deal stays playable", async () => {
  const { createFixture } = require("../lib/fixtures");
  const request = { auth: { uid: "a", token: {} }, data: { opponentId: "b" } };
  await seedMatch("m1", 1);
  await assert.rejects(createFixture.run(request), /updating/);
  await drainRebuildQueue();
  const dealt = await createFixture.run(request);
  assert.equal(dealt.fixture.aId, "a");
  assert.equal(dealt.fixture.bId, "b");
  await seedMatch("m2", 2);
  const existing = await createFixture.run(request);
  assert.equal(existing.fixture.id, dealt.fixture.id);
  assert.equal(existing.fixture.aTeamId, dealt.fixture.aTeamId);
});

test("ineligible finals cannot occupy the bounded auto-confirm query window", async () => {
  const { schedulePendingMatch } = require("../lib/scheduling");
  const regular = db.doc("matches/regular-pending"),
    finals = db.doc("matches/finals-pending");
  const createdAt = Timestamp.fromMillis(Date.now() - 7200000);
  await regular.set({ ...result, status: "pending_confirmation", createdAt });
  await finals.set({ ...result, finals: true, status: "pending_confirmation", createdAt });
  await schedulePendingMatch(regular);
  await schedulePendingMatch(finals);
  assert.equal((await finals.get()).get("autoConfirmDueAt"), null);
  const candidates = await db
    .collection("matches")
    .where("status", "==", "pending_confirmation")
    .where("seasonId", "==", "s1")
    .where("autoConfirmDueAt", ">=", Timestamp.fromMillis(0))
    .where("autoConfirmDueAt", "<=", Timestamp.now())
    .orderBy("autoConfirmDueAt")
    .limit(1)
    .get();
  assert.deepEqual(
    candidates.docs.map((row) => row.id),
    ["regular-pending"],
  );
});

test("catalogue metadata changes refresh complete profile summaries without another match", async () => {
  await seedMatch("m1", 1);
  await drainRebuildQueue();
  await db.doc("seasons/future").set({ active: false, start: Timestamp.fromMillis(1800000000000) });
  const { refreshCatalogueModels } = require("../lib/performanceSummary");
  const ref = db.doc("teamCatalogues/current"),
    before = await ref.get();
  await ref.update({
    teams: before
      .get("teams")
      .map((team) => (team.id === "t1" ? { ...team, name: "Renamed team" } : team)),
  });
  await refreshCatalogueModels.run({ data: { before, after: await ref.get() } });
  await drainRebuildQueue();
  assert.equal((await db.doc("playerStats/a").get()).get("summary").teams[0].name, "Renamed team");
  assert.equal(
    (await db.doc("seasonSummaries/s1").get()).get("usage").find((row) => row.teamKey === "t1")
      .name,
    "Renamed team",
  );
});

test("cup announcement failures do not block league updates and retry atomically", async () => {
  const { toStoredRounds } = require("../lib/cupRules");
  const { announceCupChampion } = require("../lib/cup");
  const notify = require("../lib/notify");
  const ref = db.doc("seasons/s1/cup/state");
  await ref.set({
    status: "live",
    rounds: toStoredRounds([[{ aId: "a", bId: "b", winnerId: null }]]),
  });
  const enqueue = notify.enqueuePushesTx;
  notify.enqueuePushesTx = async () => {
    throw new Error("announcement unavailable");
  };
  try {
    await seedMatch("cup-final", 1);
    await drainRebuildQueue();
  } finally {
    notify.enqueuePushesTx = enqueue;
  }
  await modelVersion();
  assert.equal((await db.doc("playerStats/a").get()).get("games"), 1);
  assert.equal((await ref.get()).get("announcedAt"), undefined);
  await announceCupChampion.run({ params: { seasonId: "s1" } });
  await announceCupChampion.run({ params: { seasonId: "s1" } });
  assert.equal((await ref.get()).get("status"), "complete");
  const pushes = (await db.collection("notificationOutbox").get()).docs.filter(
    (row) => row.get("data.type") === "cup",
  );
  assert.equal(pushes.length, 2);
});

test("finals replay resumes missed effects without re-dealing or reporting a lost race", async () => {
  const { buildBracket, advanceBracket } = require("../lib/finalsRules");
  const notify = require("../lib/notify");
  for (const uid of ["c", "d"])
    await db.doc(`leagues/office/members/${uid}`).set({ role: "member" });
  let bracket = buildBracket(
    ["a", "b", "c", "d"].map((uid, i) => ({ uid, rank: i + 1, elo: 1500 })),
  );
  bracket = advanceBracket(bracket, "s2", "b", "prior", "regulation").bracket;
  const ref = db.doc("seasons/s1/finals/bracket");
  await ref.set(bracket);
  const match = { ...result, bId: "d", finals: true, finalsSlot: "s1", decidedBy: "regulation" };
  await db.runTransaction(async (tx) => {
    tx.set(db.doc("matches/semi"), {
      ...match,
      status: "confirmed",
      date: Timestamp.now(),
      aTeam: "Team A",
      bTeam: "Team B",
      aTeamId: "t1",
      bTeamId: "t2",
    });
    requestRebuild(tx, "s1", { matchId: "semi", result: match, mode: "manual" });
  });
  const send = notify.sendPush;
  notify.sendPush = async (...args) => {
    if (args[3].type === "finals_tie_set") throw new Error("push unavailable");
    return send(...args);
  };
  try {
    await assert.rejects(drainRebuildQueue(), /push unavailable/);
  } finally {
    notify.sendPush = send;
  }
  const dealt = (await ref.get()).get("slots.gf");
  await drainRebuildQueue();
  await modelVersion();
  assert.deepEqual((await ref.get()).get("slots.gf"), dealt);
  const pushes = (await db.collection("notificationOutbox").get()).docs;
  assert.equal(pushes.filter((row) => row.get("data.type") === "finals_tie_set").length, 2);
  assert.equal(
    pushes.some((row) => String(row.get("body")).includes("already been decided")),
    false,
  );
  assert.ok((await db.doc("seasons/s1/finalsEffects/s1").get()).get("completedAt"));
});

test("batched leadership changes follow calculation order rather than the first confirmation", async () => {
  for (let i = 1; i <= 3; i++) await seedMatch(`draw${i}`, i, 1);
  await drainRebuildQueue();
  await seedMatch("neutral", 5, 1);
  await seedMatch("decider", 4, 0);
  await drainRebuildQueue();
  assert.equal((await db.doc("activity/numberone_neutral").get()).exists, false);
  assert.equal((await db.doc("activity/numberone_decider").get()).get("payload.playerId"), "b");
});

test("a batched win streak is attributed to the match reaching its milestone", async () => {
  for (let i = 1; i <= 4; i++) await seedMatch(`win${i}`, i, 3);
  await drainRebuildQueue();
  const streaks = await db.collection("activity").where("type", "==", "streak").get();
  assert.deepEqual(
    streaks.docs.map((row) => row.id),
    ["streak_win3_a"],
  );
});

test("legacy completed cups are not re-announced after deployment", async () => {
  const { toStoredRounds } = require("../lib/cupRules");
  const { announceCupChampion } = require("../lib/cup");
  await db
    .doc("seasons/s1/cup/state")
    .set({ status: "complete", rounds: toStoredRounds([[{ aId: "a", bId: "b", winnerId: "a" }]]) });
  await announceCupChampion.run({ params: { seasonId: "s1" } });
  await seedMatch("later-league-game", 1);
  await drainRebuildQueue();
  const messages = (await db.collection("notificationOutbox").get()).docs;
  assert.equal(messages.filter((row) => row.get("data.type") === "cup").length, 0);
});
