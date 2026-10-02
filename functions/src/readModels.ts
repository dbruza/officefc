import { loggedOnCall } from "./logging";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { enqueueRebuild, drainRebuildQueue, modelVersion } from "./rebuildQueue";

/** Admin-only migration/backfill for the read models introduced in M2/M3. */
export const rebuildLeagueReadModels = loggedOnCall(
  "rebuildLeagueReadModels",
  { cors: true, timeoutSeconds: 540 },
  async (req) => {
    const { uid } = requireAuth(req);
    await assertAdmin(uid);
    const db = getFirestore();
    const confirmed = await db.collection("matches").where("status", "==", "confirmed").get();
    const seasonIds = [
      ...new Set(confirmed.docs.map((snap) => String(snap.get("seasonId"))).filter(Boolean)),
    ];
    for (const seasonId of seasonIds) await enqueueRebuild(seasonId, true);
    await drainRebuildQueue();
    let queued = false;
    try {
      await modelVersion();
    } catch (error) {
      if ((error as { code?: string }).code !== "failed-precondition") throw error;
      queued = true;
    }
    return {
      ok: true,
      queued,
      seasonCount: seasonIds.length,
      matchCount: confirmed.size,
    };
  },
);
