/**
 * Explicit opt-in before a match photo goes to the third-party AI model (App Store guideline
 * 5.1.2(i)). The app asks on the first photo and stores the answer at privacySettings/{uid};
 * extractMatchStats checks it so a client that never asked (an older build, a direct call)
 * can't send a photo either.
 */
import { HttpsError } from "firebase-functions/v2/https";

/** `details.reason` on the rejection, so the app can show its consent step again. */
export const AI_PHOTO_CONSENT_REQUIRED = "ai_photo_consent_required";

/** Pure: only an explicit `aiPhotoReading: true` counts; a missing or malformed doc is a no. */
export function hasAiPhotoConsent(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { aiPhotoReading?: unknown }).aiPhotoReading === true
  );
}

/**
 * An expected rejection (failed-precondition), not a fault. Current apps act on the reason;
 * older ones show the message as-is, so it says what to do without the consent step.
 */
export function aiPhotoConsentRequired(): HttpsError {
  return new HttpsError(
    "failed-precondition",
    "To log a match from a photo, allow AI photo reading in Settings first. Don't see that option? Update the app, or log the match manually.",
    { reason: AI_PHOTO_CONSENT_REQUIRED },
  );
}
