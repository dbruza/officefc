import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { isDeepStrictEqual } from "node:util";
import { instrumentBackground } from "./sentry";
import { loggedOnCall } from "./logging";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth, assertMember } from "./auth";
import { enqueueRebuild, drainRebuildQueue } from "./rebuildQueue";
import { SUMMARY_VERSION, playerSummary } from "./models/summaries";
import { QUEUE_PATH } from "./modelWriter";

/** Compatibility bootstrap for pre-summary leagues. Normal screen reads use one document. */
export const ensurePerformanceSummary = loggedOnCall(
  "ensurePerformanceSummary",
  { cors: true, timeoutSeconds: 540 },
  async (request) => {
    const { uid } = requireAuth(request);
    await assertMember(uid);
    const seasonId = String(request.data?.seasonId ?? ""),
      playerId = String(request.data?.playerId ?? "");
    const id = seasonId || playerId;
    if (!id || id.includes("/") || id.length > 128)
      throw new HttpsError("invalid-argument", "A valid id is required.");
    const db = getFirestore();
    const target = await db.doc(seasonId ? `seasons/${id}` : `profiles/${id}`).get();
    if (!target.exists) throw new HttpsError("not-found", "Season or player not found.");
    const ref = db.doc(seasonId ? `seasonSummaries/${id}` : `playerStats/${id}`);
    const existing = await ref.get();
    if ((seasonId ? existing.get("version") : existing.get("summary.version")) === SUMMARY_VERSION)
      return seasonId ? existing.data() : existing.get("summary");
    const state = await db.doc(QUEUE_PATH).get();
    if (
      Number(state.get("requestedRevision") ?? 0) === Number(state.get("completedRevision") ?? 0)
    ) {
      const seasons = seasonId
        ? [await db.doc(`seasons/${seasonId}`).get()]
        : (await db.collection("seasons").get()).docs;
      if (!seasonId && seasons.length === 0) return playerSummary(id, [], new Map());
      for (const season of seasons) if (season.exists) await enqueueRebuild(season.id);
    }
    await drainRebuildQueue();
    const fresh = await ref.get();
    const summary = seasonId ? fresh.data() : fresh.get("summary");
    if (summary?.version !== SUMMARY_VERSION)
      throw new HttpsError("unavailable", "League statistics are updating. Please retry shortly.");
    return summary;
  },
);

/** Catalogue names/ratings also feed projections; a metadata edit must not wait for another match. */
export const refreshCatalogueModels = onDocumentWritten(
  { document: "teamCatalogues/current", region: "australia-southeast1", retry: true },
  instrumentBackground("refreshCatalogueModels", async (event) => {
    if (
      !event.data?.after.exists ||
      isDeepStrictEqual(event.data.before.get("teams"), event.data.after.get("teams"))
    )
      return;
    const db = getFirestore();
    const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
    const seasons = active.empty
      ? await db.collection("seasons").orderBy("start", "desc").limit(1).get()
      : active;
    if (!seasons.empty) await enqueueRebuild(seasons.docs[0].id);
  }),
);
