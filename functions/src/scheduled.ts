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
import {
  armAutoConfirm,
  autoConfirmMatch,
  finalizeAutoConfirmedBatch,
  markSeasonRecalcPending,
  pendingRecalcSeasonIds,
  type AutoConfirmed,
} from "./matchLifecycle";
import { canAutoConfirm, matchCreatedMillis } from "./matchRules";

const db = getFirestore();
const storage = getStorage();
const DRAFT_RETENTION_HOURS = 24;
/** Dispute window: an undisputed pending match auto-confirms once this much time has passed. */
const AUTO_CONFIRM_HOURS = 1;
/** Remind the opponent this long before the window closes, so a result never locks in on
 *  their behalf without warning. Must stay below AUTO_CONFIRM_HOURS to be reachable. */
const REMINDER_MINUTES = 30;
/**
 * Matches older than this are treated as abandoned rather than merely unanswered and are left
 * for an admin to resolve. Without a floor, the first run after deploy would sweep up every
 * pending match ever accumulated — including results whose season has since been finalized.
 */
const AUTO_CONFIRM_MAX_AGE_HOURS = 72;
/** Cap the work per invocation so one run can't exceed the function timeout. */
const AUTO_CONFIRM_BATCH_LIMIT = 50;

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
 * Warn opponents whose dispute window is about to close. Fires REMINDER_MINUTES after
 * submission — before AUTO_CONFIRM_HOURS elapses — so nobody has a result locked in on their
 * behalf without having been told. Runs every 10 minutes alongside the auto-confirm sweep.
 */
export const sendReminders = onSchedule(
  "*/10 * * * *",
  instrumentBackground("sendReminders", async () => {
    const cutoff = Date.now() - REMINDER_MINUTES * 60 * 1000;
    const pending = await db
      .collection("matches")
      .where("status", "==", "pending_confirmation")
      .get();

    let sent = 0;
    let failed = 0;
    let unageable = 0;
    for (const doc of pending.docs) {
      const data = doc.data();
      // The SAME age reader the auto-confirm uses. With two different readers, a stamp one can
      // parse and the other can't would let a match confirm having never been warned at all.
      const createdAtMs = matchCreatedMillis(data);
      if (createdAtMs === null) {
        unageable++;
        continue;
      }
      if (createdAtMs > cutoff) continue;
      if (data.reminderSentAt) continue;

      const opponentId = data.submittedBy === data.aId ? data.bId : data.aId;
      if (typeof opponentId !== "string") continue;

      // One unreachable opponent must not cost everyone behind them their warning.
      try {
        await sendPush(
          opponentId,
          "Confirm before it locks in",
          `A result needs your response — it confirms automatically ${AUTO_CONFIRM_HOURS}h after it was submitted.`,
          { type: "match_pending", matchId: doc.id },
        );
        await db.doc(`matches/${doc.id}`).update({
          reminderSentAt: FieldValue.serverTimestamp(),
        });
        sent++;
      } catch (error) {
        failed++;
        logger.error("reminder_failed", {
          matchId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // A non-zero `unageable` means matches are heading for auto-confirmation un-warned.
    if (unageable > 0) logger.warn("reminders_unageable", { unageable });
    logger.info("reminders_sent", { sent, failed, unageable });
  }),
);

/**
 * Auto-confirm pending matches whose dispute window (AUTO_CONFIRM_HOURS) has lapsed without
 * the opponent responding. The opponent keeps the full window to dispute; only after it lapses
 * does the match confirm on their behalf, marked `confirmedBy: "auto"` with an `autoConfirmedAt`
 * timestamp. Runs every 10 minutes so confirmation lands within ~10min of the window closing.
 *
 * Scope is deliberately narrow: only the active, non-finalized season, and only matches within
 * AUTO_CONFIRM_MAX_AGE_HOURS. A finalized season's standings have already been published as a
 * champion/premier, and recalcSeasonElo would rewrite them — so closed seasons are never touched
 * and long-abandoned matches are left for an admin. Read models are rebuilt once for the whole
 * batch, not once per match.
 */
export const autoConfirmStaleMatches = onSchedule(
  // maxInstances 1: two overlapping runs would race recalcLeagueStats, which is a
  // read-modify-write over shared playerStats/h2h docs including a delete pass.
  { schedule: "*/10 * * * *", timeoutSeconds: 540, maxInstances: 1 },
  instrumentBackground("autoConfirmStaleMatches", async () => {
    const now = Date.now();
    const cutoff = now - AUTO_CONFIRM_HOURS * 60 * 60 * 1000;
    const floor = now - AUTO_CONFIRM_MAX_AGE_HOURS * 60 * 60 * 1000;

    // Seasons a previous run confirmed into but didn't finish rebuilding — fold them into this
    // run's recalc so a mid-rebuild crash can't leave the tables permanently out of date.
    const heal = await pendingRecalcSeasonIds();

    // Every match already pending at deploy time was submitted under rules that said nothing
    // about auto-confirmation, and its opponent was never warned. Arming on the first run and
    // waiting a full window means they all get a real chance to dispute rather than being
    // swept up en masse within ten minutes of release.
    const armedAt = await armAutoConfirm(now);
    if (now < armedAt + AUTO_CONFIRM_HOURS * 60 * 60 * 1000) {
      if (heal.length > 0) await finalizeAutoConfirmedBatch([], heal);
      logger.info("auto_confirm_skipped", { reason: "arming", armedAt, healed: heal.length });
      return;
    }

    const active = await db
      .collection("seasons")
      .where("active", "==", true)
      .where("finalized", "==", false)
      .limit(1)
      .get();
    if (active.empty) {
      if (heal.length > 0) await finalizeAutoConfirmedBatch([], heal);
      logger.info("auto_confirm_skipped", { reason: "no_active_season", healed: heal.length });
      return;
    }
    const seasonId = active.docs[0].id;

    const pending = await db
      .collection("matches")
      .where("status", "==", "pending_confirmation")
      .where("seasonId", "==", seasonId)
      .get();

    // Cheap pre-filter with the same predicate the transaction re-applies; the transaction is
    // the authority, this just avoids a write attempt per ineligible doc. Finals are rejected
    // by canAutoConfirm itself and fall into `ineligible`.
    const eligible: string[] = [];
    let ineligible = 0;
    let abandoned = 0;
    let truncated = false;
    for (const doc of pending.docs) {
      const data = doc.data();
      if (canAutoConfirm(data, cutoff, floor)) {
        if (eligible.length >= AUTO_CONFIRM_BATCH_LIMIT) {
          // More than one run's worth is waiting; the next run picks up the remainder.
          truncated = true;
          break;
        }
        eligible.push(doc.id);
      } else if (canAutoConfirm(data, cutoff)) abandoned++;
      else ineligible++;
    }

    // Mark the season before flipping anything. A flip and its rebuild can't share a
    // transaction, so without this marker a crash in between would leave a match confirmed but
    // missing from the tables, and invisible to the next run — it is no longer pending.
    if (eligible.length > 0) await markSeasonRecalcPending([seasonId]);

    const batch: AutoConfirmed[] = [];
    let flipFailed = 0;
    for (const matchId of eligible) {
      // One contended or failed transaction must not abandon the matches behind it — those
      // would stay pending but lose this run's rebuild and notifications.
      try {
        const result = await autoConfirmMatch(matchId, cutoff, floor);
        if (result) batch.push({ matchId, result });
      } catch (error) {
        flipFailed++;
        logger.error("auto_confirm_flip_failed", {
          matchId,
          seasonId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Anything we marked has to be cleared by this run, even if every flip lost its race and the
    // batch came back empty — otherwise the season stays pending and is re-swept forever.
    const outcome = await finalizeAutoConfirmedBatch(
      batch,
      eligible.length > 0 ? [...heal, seasonId] : heal,
    );
    // `eligible` vs `confirmed` distinguishes a quiet run from one where every transaction is
    // failing — both would otherwise log `confirmed: 0`.
    if (eligible.length > 0 && batch.length === 0) {
      logger.warn("auto_confirm_all_lost_race", { eligible: eligible.length, seasonId });
    }
    if (abandoned > 0) logger.warn("auto_confirm_abandoned", { abandoned, seasonId });
    logger.info("auto_confirm_done", {
      eligible: eligible.length,
      confirmed: batch.length,
      flipFailed,
      ineligible,
      abandoned,
      healed: heal.length,
      seasonId,
      truncated,
      ...outcome,
    });
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
