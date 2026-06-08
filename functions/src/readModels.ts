import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { recalcSeasonElo, recalcLeagueStats } from "./recalc";

/** Admin-only migration/backfill for the read models introduced in M2/M3. */
export const rebuildLeagueReadModels = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const db = getFirestore();
  const confirmed = await db.collection("matches").where("status", "==", "confirmed").get();
  const seasonIds = [
    ...new Set(confirmed.docs.map((snap) => String(snap.get("seasonId"))).filter(Boolean)),
  ];
  for (const seasonId of seasonIds) await recalcSeasonElo(seasonId);
  await recalcLeagueStats();
  return { ok: true, seasonCount: seasonIds.length, matchCount: confirmed.size };
});
