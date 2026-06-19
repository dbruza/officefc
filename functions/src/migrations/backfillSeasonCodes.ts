import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readSeasonJoinCode, writeSeasonJoinCode } from "../utils";

/**
 * ONE-OFF, TEMPORARY migration for the join-code relocation shipped in #22.
 *
 * #22 moved season join codes off the member-readable `seasons/{id}.joinCode` field into the
 * function-only `seasonCodes/{id}` collection. Existing seasons still carry the legacy field, so
 * already-shared invite codes would stop resolving once the new readers go live. For every season
 * with a legacy `joinCode`, this:
 *   1. writes `seasonCodes/{id} = { code }` (only if a code isn't already there), then
 *   2. strips the now-relocated `joinCode` field off the season doc so members can no longer
 *      harvest it — completing #22's security goal for pre-existing seasons.
 *
 * Idempotent: re-running finds no legacy field and reports it as skipped.
 *
 * Guarded by a nonce so a stray request can't trigger it. Before deploy, set BACKFILL_NONCE in
 * functions/.env (any unguessable value), then run once:
 *   curl "https://<region>-<project>.cloudfunctions.net/backfillSeasonCodes?nonce=<value>"
 *
 * DELETE this file and its export in src/index.ts once the backfill has run successfully.
 */
export const backfillSeasonCodes = onRequest(async (req, res) => {
  const expected = process.env.BACKFILL_NONCE;
  if (!expected) {
    res.status(503).send("BACKFILL_NONCE is not configured.");
    return;
  }
  if (req.query.nonce !== expected) {
    res.status(403).send("Forbidden.");
    return;
  }

  const db = getFirestore();
  const seasons = await db.collection("seasons").get();
  let migrated = 0;
  let stripped = 0;
  let skipped = 0;
  const details: Array<{ seasonId: string; action: string }> = [];

  for (const doc of seasons.docs) {
    const legacy = doc.get("joinCode");
    if (typeof legacy !== "string" || !legacy) {
      skipped++;
      continue;
    }

    const existing = await readSeasonJoinCode(doc.id, db);
    if (existing) {
      details.push({ seasonId: doc.id, action: "code-already-present" });
    } else {
      await writeSeasonJoinCode(doc.id, legacy, db);
      migrated++;
      details.push({ seasonId: doc.id, action: "migrated" });
    }

    // Remove the relocated field last, so a failure can never lose the code.
    await doc.ref.update({ joinCode: FieldValue.delete() });
    stripped++;
  }

  logger.info("backfillSeasonCodes", { migrated, stripped, skipped });
  res.status(200).json({ migrated, stripped, skipped, details });
});
