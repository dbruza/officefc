import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { LEAGUE_ID } from "../config";
import { extractMatchFromImage } from "./core/extract.mjs";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-4-5";

const db = getFirestore();
const storage = getStorage();

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const RATE_LIMIT_MAX = 10;

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_EDGE = 1568;

function requireAuth(req: { auth?: { uid: string; token: { email?: string } } }): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth.uid;
}

async function assertMember(uid: string): Promise<void> {
  const snap = await db.doc(`leagues/${LEAGUE_ID}/members/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "League members only.");
}

function validateStoragePath(uid: string, draftId: string, storagePath: string): void {
  const prefix = `match-photos/${uid}/${draftId}/`;
  if (!storagePath.startsWith(prefix)) {
    throw new HttpsError(
      "invalid-argument",
      "Storage path does not belong to the authenticated user.",
    );
  }
}

async function checkRateLimit(uid: string): Promise<void> {
  const ref = db.doc(`aiRateLimits/${uid}`);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const timestamps: number[] = snap.exists
      ? (snap.get("timestamps") ?? [])
      : [];
    const recent = timestamps.filter((t: number) => t > windowStart);
    if (recent.length >= RATE_LIMIT_MAX) {
      throw new HttpsError(
        "resource-exhausted",
        `Rate limit reached. ${RATE_LIMIT_MAX} extractions per hour.`,
      );
    }
    recent.push(now);
    tx.set(ref, { timestamps: recent, updatedAt: FieldValue.serverTimestamp() });
  });
}

async function downscaleImage(
  buffer: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const sharp = await import("sharp");
  const image = sharp.default(buffer);
  const metadata = await image.metadata();
  const { width = 0, height = 0 } = metadata;
  if (width <= MAX_EDGE && height <= MAX_EDGE) {
    return { buffer, contentType };
  }
  const resized = await image
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { buffer: resized, contentType: "image/jpeg" };
}

function isImageType(contentType: string | undefined): boolean {
  return !!contentType && ALLOWED_TYPES.includes(contentType);
}

export const extractMatchStats = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (req) => {
    const uid = requireAuth(req);
    await assertMember(uid);

    const { draftId, storagePath, force } = req.data as {
      draftId?: string;
      storagePath?: string;
      force?: boolean;
    };

    if (!draftId || !storagePath) {
      throw new HttpsError("invalid-argument", "draftId and storagePath are required.");
    }

    validateStoragePath(uid, draftId, storagePath);

    const draftRef = db.doc(`matchDrafts/${draftId}`);
    const existing = await draftRef.get();
    if (existing.exists && !force) {
      const data = existing.data()!;
      if (data.status === "done" && data.ownerUid === uid) {
        return data;
      }
    }

    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [metadataResult] = await file.getMetadata();
    const contentType = String(metadataResult.contentType ?? "");
    const fileSize = Number(metadataResult.size ?? 0);

    if (!isImageType(contentType)) {
      throw new HttpsError("invalid-argument", "Not a supported image type.");
    }
    if (fileSize > MAX_FILE_SIZE) {
      throw new HttpsError("invalid-argument", `File too large (${(fileSize / 1024 / 1024).toFixed(1)} MB).`);
    }

    await checkRateLimit(uid);

    const [rawBuffer] = await file.download();
    const { buffer, contentType: processedType } = await downscaleImage(
      rawBuffer,
      contentType,
    );
    const imageBase64 = buffer.toString("base64");

    let extractionResult;
    try {
      const raw = await extractMatchFromImage({
        imageBase64,
        mediaType: processedType,
        model: ANTHROPIC_MODEL,
        apiKey: ANTHROPIC_API_KEY.value(),
      });
      extractionResult = raw;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await draftRef.set({
        status: "failed",
        ownerUid: uid,
        storagePath,
        error: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new HttpsError("internal", `Extraction failed: ${message}`);
    }

    await draftRef.set({
      ownerUid: uid,
      storagePath,
      status: "done",
      raw: extractionResult,
      confidence: extractionResult.confidence,
      requiresReview: extractionResult.requiresReview,
      flags: extractionResult.flags,
      model: ANTHROPIC_MODEL,
      extractedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists
        ? existing.get("createdAt") ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      draftId,
      ok: extractionResult.ok,
      detectedScreen: extractionResult.detectedScreen,
      confidence: extractionResult.confidence,
      requiresReview: extractionResult.requiresReview,
      flags: extractionResult.flags,
      suggestion: extractionResult.suggestion,
    };
  },
);
