import { HttpsError } from "firebase-functions/v2/https";
import { loggedOnCall } from "../logging";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { requireAuth, assertMember } from "../auth";

const db = getFirestore();
const storage = getStorage();
const SIGNED_URL_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Return a short-lived signed read URL for a match's private photo.
 * The client must be a league member; the photo path must be stored on the match doc.
 */
export const getMatchPhotoUrl = loggedOnCall("getMatchPhotoUrl", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);

  const matchId = String(req.data?.matchId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "matchId is required.");

  const snap = await db.doc(`matches/${matchId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Match not found.");

  const data = snap.data()!;
  const source = String(data.source ?? "");
  if (source !== "ai_assisted") {
    throw new HttpsError("failed-precondition", "Only AI-assisted matches have photos.");
  }

  const photoPath = String(data.photoPath ?? "");
  if (!photoPath) throw new HttpsError("not-found", "No photo stored for this match.");

  const bucket = storage.bucket();
  const file = bucket.file(photoPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "Photo no longer exists.");

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + SIGNED_URL_TTL_MS,
  });

  return { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS };
});
