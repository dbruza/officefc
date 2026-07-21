import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { LEAGUE_ID } from "./config";
import { calculateSeason } from "./elo";
import { sendPush } from "./notify";
import { isStaleUnsubmittedDraft } from "./extract/draftLifecycle";
import type { DraftState } from "./extract/draftSecurity";
import { dateMillis, seasonMatchInputsWithTeams } from "./utils";
import { instrumentBackground } from "./sentry";

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

/**
 * Weekly leaderboard snapshot: write rank+ELO for every player in the active season.
 * Runs every Sunday at 00:00 UTC.
 */
export const weeklySnapshot = onSchedule(
  "0 0 * * 0",
  instrumentBackground("weeklySnapshot", async () => {
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

    // Finals matches decide the bracket only — exclude them like every other ELO consumer.
    const matches = await seasonMatchInputsWithTeams(
      matchSnaps.docs.filter((doc) => doc.get("finals") !== true),
      db,
    );

    const premierId = active.docs[0].get("reigningPremierId");
    const result = calculateSeason(
      matches,
      members.docs.map((s) => s.id),
      dateMillis(active.docs[0].get("start")),
      { premierId: typeof premierId === "string" ? premierId : null },
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

    // Only ranked players appear in the snapshot and get a move indicator; provisional players
    // (rank 0) are skipped so crossing into the ranked table doesn't read as a huge jump.
    const rows: Record<string, { rank: number; elo: number }> = {};
    for (const standing of result.standings) {
      if (!standing.ranked) continue;
      rows[standing.uid] = { rank: standing.rank, elo: standing.elo };
      const prevRank = prevRanks.get(standing.uid) ?? standing.rank;
      standing.move = prevRank - standing.rank;
    }

    const writer = db.bulkWriter();
    writer.set(ref, { weekKey, seasonId, rows, capturedAt: FieldValue.serverTimestamp() });
    for (const standing of result.standings) {
      if (!standing.ranked) continue;
      writer.set(
        db.doc(`seasons/${seasonId}/standings/${standing.uid}`),
        { move: standing.move },
        { merge: true },
      );
    }
    await writer.close();
  }),
);

/**
 * Send reminder pushes to opponents of pending matches older than 48 hours.
 * Runs every 6 hours.
 */
export const sendReminders = onSchedule(
  "0 */6 * * *",
  instrumentBackground("sendReminders", async () => {
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
    logger.info("reminders_sent", { sent });
  }),
);

/**
 * Remove private uploads for AI drafts that were never submitted.
 * Runs daily at 03:00 UTC; failed object deletions remain marked for the next run.
 */
export const cleanupAbandonedDrafts = onSchedule(
  "0 3 * * *",
  instrumentBackground("cleanupAbandonedDrafts", async () => {
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
    logger.info("stale_drafts_deleted", { deleted });
  }),
);
