import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { backfillMatchResult } from "../activityFeed";
import { dateMillis } from "../utils";

/**
 * ONE-OFF, TEMPORARY migration to seed the activity feed (A1) on launch.
 *
 * The feed is populated going forward by confirmMatch/resolveMatch/finalizeSeason, but a
 * freshly deployed feed is empty until new matches land. This writes a `match_result` event
 * for the most recent confirmed matches so the feed has content from day one. Computed events
 * (streak/upset/new #1) are NOT backfilled — they start fresh from deploy.
 *
 * Idempotent: result events use deterministic IDs (`result_<matchId>`) and are skipped if they
 * already exist, so this is safe to re-run and safe to race against live confirmMatch writes.
 *
 * Guarded by a nonce. Before deploy, set BACKFILL_NONCE in functions/.env, then run once:
 *   curl "https://<region>-<project>.cloudfunctions.net/backfillActivityFeed?nonce=<value>"
 * Optionally pass &limit=<n> (default 20, max 100).
 *
 * DELETE this file and its export in src/index.ts once the backfill has run successfully.
 */
export const backfillActivityFeed = onRequest(async (req, res) => {
  const expected = process.env.BACKFILL_NONCE;
  if (!expected) {
    res.status(503).send("BACKFILL_NONCE is not configured.");
    return;
  }
  if (req.query.nonce !== expected) {
    res.status(403).send("Forbidden.");
    return;
  }
  const requested = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.trunc(requested)), 100) : 20;

  const db = getFirestore();
  const confirmed = await db.collection("matches").where("status", "==", "confirmed").get();

  const recent = confirmed.docs
    .map((doc) => ({ doc, when: dateMillis(doc.get("date") ?? doc.get("confirmedAt")) }))
    .sort((a, b) => b.when - a.when)
    .slice(0, limit);

  let seeded = 0;
  for (const { doc, when } of recent) {
    const data = doc.data();
    await backfillMatchResult(
      db,
      {
        id: doc.id,
        seasonId: String(data.seasonId),
        aId: String(data.aId),
        bId: String(data.bId),
        aGoals: Number(data.aGoals),
        bGoals: Number(data.bGoals),
        aDelta: Number(data.aDelta ?? 0),
        bDelta: Number(data.bDelta ?? 0),
      },
      when,
    );
    seeded++;
  }

  logger.info("backfillActivityFeed", { seeded, scanned: confirmed.size, limit });
  res.status(200).json({ seeded, scanned: confirmed.size, limit });
});
