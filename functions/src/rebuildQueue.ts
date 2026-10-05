import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { QUEUE_PATH } from "./modelWriter";
import { recalcSeasonElo, recalcLeagueStats, rebuildFrozenSeasonSummary } from "./recalc";
import { emitMatchActivity, topRankedLeaderId } from "./activityFeed";
import { sendPush } from "./notify";
import type { ConfirmResult } from "./matchLifecycle";
import { instrumentBackground } from "./sentry";

interface ConfirmationWork {
  matchId: string;
  result: ConfirmResult;
  mode: "manual" | "auto" | "admin";
}
export function requestRebuild(
  tx: Transaction,
  seasonId: string,
  event?: ConfirmationWork,
  replayFinalized = false,
): void {
  const db = getFirestore();
  tx.set(
    db.doc(QUEUE_PATH),
    {
      requestedRevision: FieldValue.increment(1),
      dirtySeasons: FieldValue.arrayUnion(seasonId),
      ...(replayFinalized ? { replayFinalizedSeasons: FieldValue.arrayUnion(seasonId) } : {}),
      requestedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  tx.update(db.doc(`seasons/${seasonId}`), { modelRevision: FieldValue.increment(1) });
  if (event)
    tx.set(db.doc(`readModelEvents/${event.matchId}`), {
      ...event,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
}
export async function enqueueRebuild(seasonId: string, replayFinalized = false): Promise<void> {
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const season = await tx.get(db.doc(`seasons/${seasonId}`));
    if (!season.exists) return;
    requestRebuild(tx, seasonId, undefined, replayFinalized);
  });
}

export async function assertQueueIdleTx(tx: Transaction, expected?: number): Promise<number> {
  const state = await tx.get(getFirestore().doc(QUEUE_PATH));
  const revision = Number(state.get("requestedRevision") ?? 0);
  if (
    revision !== Number(state.get("completedRevision") ?? 0) ||
    (state.get("leaseToken") && Number(state.get("leaseUntil")) > Date.now()) ||
    (expected !== undefined && expected !== revision)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Standings are updating. Please retry in a moment.",
    );
  }
  return revision;
}
export async function modelVersion(): Promise<number> {
  return getFirestore().runTransaction((tx) => assertQueueIdleTx(tx));
}

/** Lease plus fenced publication: triggers, recovery, and admin repair all use one writer. */
export async function drainRebuildQueue(): Promise<boolean> {
  const db = getFirestore(),
    ref = db.doc(QUEUE_PATH),
    token = randomUUID();
  const work = await db.runTransaction(async (tx) => {
    const state = await tx.get(ref);
    if (
      !state.exists ||
      Number(state.get("requestedRevision")) <= Number(state.get("completedRevision") ?? 0)
    )
      return null;
    if (state.get("leaseToken") && Number(state.get("leaseUntil")) > Date.now()) return null;
    tx.update(ref, { leaseToken: token, leaseUntil: Date.now() + 480_000 });
    return {
      revision: Number(state.get("requestedRevision")),
      seasons: (state.get("dirtySeasons") ?? []) as string[],
      replayFinalized: (state.get("replayFinalizedSeasons") ?? []) as string[],
      cutoff: state.readTime,
    };
  });
  if (!work) return false;
  const start = Date.now();
  try {
    const seasons = work.seasons.length
      ? await db.getAll(...work.seasons.map((id) => db.doc(`seasons/${id}`)))
      : [];
    const before = new Map<string, string | null>();
    for (const season of seasons) {
      if (!season.exists) continue;
      before.set(season.id, await topRankedLeaderId(db, season.id));
      if (season.get("finalized") && !work.replayFinalized.includes(season.id))
        await rebuildFrozenSeasonSummary(season.id, { token });
      else await recalcSeasonElo(season.id, { token });
    }
    await recalcLeagueStats({ token });
    const events = await db
      .collection("readModelEvents")
      .where("status", "==", "pending")
      .where("createdAt", "<=", work.cutoff)
      .orderBy("createdAt")
      .limit(200)
      .get();
    const { finalizeConfirmation } = await import("./matchLifecycle.js");
    const credited = new Set<string>(),
      winners = new Set<string>();
    for (const event of events.docs) {
      await db.runTransaction(async (tx) => {
        const lock = await tx.get(ref);
        if (lock.get("leaseToken") !== token || Number(lock.get("leaseUntil")) <= Date.now())
          throw new Error("Rebuild lease lost");
        tx.update(ref, { leaseUntil: Date.now() + 480000 });
      });
      const { matchId, result, mode } = event.data() as ConfirmationWork;
      if (!before.has(result.seasonId)) {
        await event.ref.update({
          status: "discarded",
          expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
        });
        continue;
      }
      await finalizeConfirmation(
        result,
        matchId,
        mode === "auto"
          ? "Match auto-confirmed"
          : mode === "admin"
            ? "Match resolved"
            : "Match confirmed",
        `Your ${result.aGoals}-${result.bGoals} result is confirmed.`,
      );
      if (!result.finals) {
        const winner =
          result.aGoals > result.bGoals
            ? result.aId
            : result.bGoals > result.aGoals
              ? result.bId
              : null;
        await emitMatchActivity({
          db,
          matchId,
          seasonId: result.seasonId,
          previousLeaderId: credited.has(result.seasonId)
            ? await topRankedLeaderId(db, result.seasonId)
            : (before.get(result.seasonId) ?? null),
          suppressStreak: winner !== null && winners.has(winner),
        });
        credited.add(result.seasonId);
        if (winner) winners.add(winner);
      }
      if (mode === "auto") {
        const opponent = result.submittedBy === result.aId ? result.bId : result.aId;
        await sendPush(
          opponent,
          "Result confirmed automatically",
          `The ${result.aGoals}-${result.bGoals} result you didn't respond to is confirmed.`,
          { type: "match_confirmed", matchId },
        );
      }
      // Only acknowledge after every durable side effect was enqueued.
      await db.runTransaction(async (tx) => {
        const state = await tx.get(ref);
        if (state.get("leaseToken") !== token || Number(state.get("leaseUntil")) <= Date.now())
          throw new Error("Rebuild lease lost");
        tx.update(event.ref, {
          status: "done",
          completedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
        });
      });
    }
    await db.runTransaction(async (tx) => {
      const state = await tx.get(ref);
      const refs = seasons.filter((s) => s.exists).map((s) => s.ref);
      const currentSeasons = refs.length ? await tx.getAll(...refs) : [];
      if (state.get("leaseToken") !== token || Number(state.get("leaseUntil")) <= Date.now())
        throw new Error("Rebuild lease lost");
      for (const season of currentSeasons) {
        const captured = seasons.find((s) => s.id === season.id)!;
        tx.update(season.ref, { modelAppliedRevision: Number(captured.get("modelRevision") ?? 0) });
      }
      tx.update(ref, {
        completedRevision:
          events.size === 200 ? Number(state.get("completedRevision") ?? 0) : work.revision,
        ...(Number(state.get("requestedRevision")) === work.revision && events.size < 200
          ? { dirtySeasons: [], replayFinalizedSeasons: [] }
          : {}),
        leaseToken: null,
        leaseUntil: 0,
        completedAt: FieldValue.serverTimestamp(),
      });
    });
    logger.info("read_models_ready", {
      revision: work.revision,
      durationMs: Date.now() - start,
      events: events.size,
    });
    return true;
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const state = await tx.get(ref);
      if (state.get("leaseToken") === token) tx.update(ref, { leaseToken: null, leaseUntil: 0 });
    });
    throw error;
  }
}
export const rebuildQueuedModels = onDocumentWritten(
  {
    document: QUEUE_PATH,
    timeoutSeconds: 540,
    maxInstances: 1,
    concurrency: 1,
    retry: true,
  },
  instrumentBackground("rebuildQueuedModels", async (event) => {
    if (event.data?.before.get("requestedRevision") === event.data?.after.get("requestedRevision"))
      return;
    await drainRebuildQueue();
  }),
);
export const recoverQueuedModels = onSchedule(
  {
    schedule: "* * * * *",
    timeoutSeconds: 540,
    maxInstances: 1,
    concurrency: 1,
  },
  instrumentBackground("recoverQueuedModels", async () => {
    await drainRebuildQueue();
  }),
);
