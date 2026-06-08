import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { generateUniqueJoinCode } from "./utils";

/** Admin-only: get (or generate) the join code for a season. */
export const getSeasonJoinCode = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const db = getFirestore();

  let seasonId = String(req.data?.seasonId ?? "").trim();
  if (!seasonId) {
    const active = await db.collection("seasons").where("active", "==", true).limit(1).get();
    if (active.empty) throw new HttpsError("not-found", "No active season found.");
    seasonId = active.docs[0].id;
  }

  const ref = db.doc(`seasons/${seasonId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Season not found.");

  let code = snap.get("joinCode") as string | undefined;
  if (!code) {
    code = await generateUniqueJoinCode();
    await ref.update({ joinCode: code });
  }
  return { seasonId, code };
});

/** Admin-only: rotate the join code for a season (old code stops working immediately). */
export const rotateSeasonJoinCode = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const db = getFirestore();

  const seasonId = String(req.data?.seasonId ?? "").trim();
  if (!seasonId) throw new HttpsError("invalid-argument", "seasonId is required.");

  const ref = db.doc(`seasons/${seasonId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Season not found.");

  const code = await generateUniqueJoinCode();
  await ref.update({ joinCode: code });
  return { seasonId, code };
});
