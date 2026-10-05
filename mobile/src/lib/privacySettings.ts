/**
 * Per-user privacy choices, stored at privacySettings/{uid} with rules allowing each user
 * to read/write only their own doc. `aiPhotoReading` is the explicit opt-in to send match
 * photos to the third-party AI model (App Store guideline 5.1.2(i)). The functions side
 * (functions/src/extract/aiConsent.ts) refuses a photo unless it is true, so on both sides
 * a missing doc means "not allowed".
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { timed } from "./logger";

/** Whether the user has allowed AI photo reading; no doc (never asked) means no. */
export async function getAiPhotoConsent(uid: string): Promise<boolean> {
  return timed("getAiPhotoConsent", async () => {
    const snap = await getDoc(doc(db, "privacySettings", uid));
    return snap.exists() && snap.get("aiPhotoReading") === true;
  });
}

/**
 * Record the user's answer with its timestamp (the field set the security rules allow).
 * Merged, so other privacy fields on the doc (e.g. termsAcceptedAt) are kept.
 */
export async function setAiPhotoConsent(uid: string, allowed: boolean): Promise<void> {
  return timed("setAiPhotoConsent", async () => {
    await setDoc(
      doc(db, "privacySettings", uid),
      { aiPhotoReading: allowed, aiPhotoReadingUpdatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}
