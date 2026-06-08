import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { LEAGUE_ID } from "./config";
import { calculateSeason } from "./elo";
import { sendPush } from "./notify";
import { isStaleUnsubmittedDraft } from "./extract/draftLifecycle";
import type { DraftState } from "./extract/draftSecurity";

const db = getFirestore();
const storage = getStorage();
const REMINDER_HOURS = 48;
const DRAFT_RETENTION_HOURS = 24;

function getWeekKey(ms: number): string {
  const d = new Date(ms);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function dateMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Weekly leaderboard snapshot: write rank+ELO for every player in the active season.
 * Runs every Sunday at 00:00 UTC.
 */
export const weeklySnapshot = onSchedule("0 0 * * 0", async () => {
  const active = await db
    .collection("seasons")
    .where("active", "==", true)
    .where("finalized", "==", false)
    .limit(1)
    .get();
  if (active.empty) return;

  const seasonId = active.docs[0].id;
  const [members, matchSnaps, oldSnaps] = await Promise.all([
    db.collection(`leagues/${LEAGUE_ID}/members`).get(),
    db
      .collection("matches")
      .where("seasonId", "==", seasonId)
      .where("status", "==", "confirmed")
      .get(),
    db.collection(`seasons/${seasonId}/snapshots`).get(),
  ]);

  const matches = matchSnaps.docs.map((snap) => {
    const data = snap.data();
    return {
      id: snap.id,
      aId: String(data.aId),
      bId: String(data.bId),
      aGoals: Number(data.aGoals),
      bGoals: Number(data.bGoals),
      aShotsOnTarget: data.aShotsOnTarget != null ? Number(data.aShotsOnTarget) : null,
      bShotsOnTarget: data.bShotsOnTarget != null ? Number(data.bShotsOnTarget) : null,
      aPossession: data.aPossession != null ? Number(data.aPossession) : null,
      bPossession: data.bPossession != null ? Number(data.bPossession) : null,
      dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
    };
  });

  const result = calculateSeason(
    matches,
    members.docs.map((s) => s.id),
    dateMillis(active.docs[0].get("start")),
  );

  const weekKey = getWeekKey(Date.now());
  const ref = db.doc(`seasons/${seasonId}/snapshots/${weekKey}`);

  const prevSnap = oldSnaps.docs
    .map((doc) => ({
      id: doc.id,
      rows: doc.get("rows") as Record<string, { rank: number; elo: number }> | undefined,
    }))
    .sort((a, b) => b.id.localeCompare(a.id))[0];

  const prevRanks = new Map<string, number>();
  if (prevSnap?.rows) {
    for (const [uid, row] of Object.entries(prevSnap.rows)) {
      prevRanks.set(uid, row.rank);
    }
  }

  const rows: Record<string, { rank: number; elo: number }> = {};
  let rank = 1;
  for (const standing of result.standings) {
    rows[standing.uid] = { rank, elo: standing.elo };
    const prevRank = prevRanks.get(standing.uid) ?? rank;
    const move = prevRank - rank;
    standing.move = move;
    rank++;
  }

  const writer = db.bulkWriter();
  writer.set(ref, { weekKey, seasonId, rows, capturedAt: FieldValue.serverTimestamp() });
  for (const standing of result.standings) {
    writer.set(
      db.doc(`seasons/${seasonId}/standings/${standing.uid}`),
      { move: standing.move },
      { merge: true },
    );
  }
  await writer.close();
});

/**
 * Send reminder pushes to opponents of pending matches older than 48 hours.
 * Runs every 6 hours.
 */
export const sendReminders = onSchedule("0 */6 * * *", async () => {
  const cutoff = Date.now() - REMINDER_HOURS * 60 * 60 * 1000;
  const pending = await db
    .collection("matches")
    .where("status", "==", "pending_confirmation")
    .get();

  let sent = 0;
  for (const doc of pending.docs) {
    const data = doc.data();
    const createdAtMs = dateMillis(data.createdAt ?? data.date);
    if (createdAtMs > cutoff) continue;
    if (data.reminderSentAt) continue;

    const opponentId = data.submittedBy === data.aId ? data.bId : data.aId;
    if (typeof opponentId !== "string") continue;

    await sendPush(
      opponentId,
      "Pending confirmation",
      `A match from over ${REMINDER_HOURS}h ago needs your confirmation.`,
      { type: "match_pending", matchId: doc.id },
    );

    await db.doc(`matches/${doc.id}`).update({
      reminderSentAt: FieldValue.serverTimestamp(),
    });
    sent++;
  }
  console.log(`Reminders sent: ${sent}`);
});

/**
 * Remove private uploads for AI drafts that were never submitted.
 * Runs daily at 03:00 UTC; failed object deletions remain marked for the next run.
 */
export const cleanupAbandonedDrafts = onSchedule("0 3 * * *", async () => {
  const cutoffMillis = Date.now() - DRAFT_RETENTION_HOURS * 60 * 60 * 1000;
  const drafts = await db.collection("matchDrafts").where("submitted", "==", false).get();

  let deleted = 0;
  for (const snapshot of drafts.docs) {
    const data = snapshot.data() as DraftState & { createdAt?: unknown };
    if (
      !isStaleUnsubmittedDraft({
        createdAtMillis: dateMillis(data.createdAt),
        submitted: data.submitted,
        cutoffMillis,
      })
    ) {
      continue;
    }

    const claimed = await db.runTransaction(async (tx) => {
      const current = await tx.get(snapshot.ref);
      if (!current.exists) return null;
      const currentData = current.data() as DraftState & { createdAt?: unknown };
      if (
        !isStaleUnsubmittedDraft({
          createdAtMillis: dateMillis(currentData.createdAt),
          submitted: currentData.submitted,
          cutoffMillis,
        })
      ) {
        return null;
      }
      tx.update(snapshot.ref, {
        status: "abandoning",
        cleanupStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return typeof currentData.storagePath === "string" ? currentData.storagePath : "";
    });
    if (claimed === null) continue;

    if (claimed) {
      const file = storage.bucket().file(claimed);
      const [exists] = await file.exists();
      if (exists) await file.delete();
    }

    await db.runTransaction(async (tx) => {
      const current = await tx.get(snapshot.ref);
      if (!current.exists) return;
      const currentData = current.data() as DraftState;
      if (currentData.submitted !== true && currentData.status === "abandoning") {
        tx.delete(snapshot.ref);
      }
    });
    deleted++;
  }
  console.log(`Stale AI drafts deleted: ${deleted}`);
});
