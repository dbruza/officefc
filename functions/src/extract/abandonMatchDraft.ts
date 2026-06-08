import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  DraftSecurityError,
  assertValidDraftId,
  type DraftState,
} from "./draftSecurity";
import { evaluateDraftAbandonment } from "./draftLifecycle";

const db = getFirestore();
const storage = getStorage();

function asHttpsError(error: DraftSecurityError): HttpsError {
  return new HttpsError(error.code, error.message);
}

async function deleteIfPresent(storagePath: string): Promise<void> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();
  if (exists) await file.delete();
}

export const abandonMatchDraft = onCall({ cors: true }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = req.auth.uid;
  const draftId = String(req.data?.draftId ?? "").trim();
  try {
    assertValidDraftId(draftId);
  } catch (error) {
    if (error instanceof DraftSecurityError) throw asHttpsError(error);
    throw error;
  }

  const draftRef = db.doc(`matchDrafts/${draftId}`);
  const matchRef = db.doc(`matches/${draftId}`);
  const result = await db.runTransaction(async (tx) => {
    const draftSnap = await tx.get(draftRef);
    const matchSnap = await tx.get(matchRef);
    let action;
    try {
      action = evaluateDraftAbandonment({
        draft: draftSnap.exists ? (draftSnap.data() as DraftState) : null,
        matchExists: matchSnap.exists,
        uid,
      });
    } catch (error) {
      if (error instanceof DraftSecurityError) throw asHttpsError(error);
      throw error;
    }
    if (action.action === "abandon") {
      tx.update(draftRef, {
        status: "abandoning",
        abandonedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return action;
  });

  if (result.action === "missing") return { ok: true };

  await deleteIfPresent(result.storagePath);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(draftRef);
    if (!snap.exists) return;
    const data = snap.data() as DraftState;
    if (data.ownerUid !== uid || data.submitted === true || data.status !== "abandoning") {
      throw new HttpsError("failed-precondition", "That AI draft can no longer be abandoned.");
    }
    tx.delete(draftRef);
  });
  return { ok: true };
});
