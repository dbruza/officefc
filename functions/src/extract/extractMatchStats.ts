import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { LEAGUE_ID } from "../config";
import { extractMatchFromImage } from "./core/extract.mjs";
import {
  assertValidDraftId,
  DraftSecurityError,
  evaluateDraftClaim,
  type DraftState,
} from "./draftSecurity";

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

function asHttpsError(error: DraftSecurityError): HttpsError {
  return new HttpsError(error.code, error.message);
}

function responseFromDraft(draftId: string, data: DraftState & Record<string, unknown>) {
  const extraction = (data.raw ?? {}) as Record<string, unknown>;
  return {
    draftId,
    ok: extraction.ok === true,
    detectedScreen: extraction.detectedScreen === true,
    confidence: extraction.confidence ?? data.confidence ?? 0,
    requiresReview: extraction.requiresReview ?? data.requiresReview ?? true,
    flags: extraction.flags ?? data.flags ?? [],
    suggestion: extraction.suggestion ?? null,
  };
}

async function checkRateLimit(uid: string): Promise<void> {
  const ref = db.doc(`aiRateLimits/${uid}`);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const timestamps: number[] = snap.exists ? (snap.get("timestamps") ?? []) : [];
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
  { cors: true, secrets: [ANTHROPIC_API_KEY] },
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

    try {
      assertValidDraftId(draftId);
    } catch (error) {
      if (error instanceof DraftSecurityError) throw asHttpsError(error);
      throw error;
    }
    validateStoragePath(uid, draftId, storagePath);

    const draftRef = db.doc(`matchDrafts/${draftId}`);
    const matchRef = db.doc(`matches/${draftId}`);
    const claim = await db.runTransaction(async (tx) => {
      const draftSnap = await tx.get(draftRef);
      const matchSnap = await tx.get(matchRef);
      const draft = draftSnap.exists ? (draftSnap.data() as DraftState) : null;
      let action;
      try {
        action = evaluateDraftClaim({
          draft,
          matchExists: matchSnap.exists,
          uid,
          storagePath,
          force: force === true,
        });
      } catch (error) {
        if (error instanceof DraftSecurityError) throw asHttpsError(error);
        throw error;
      }

      if (action === "reuse") {
        return { action, data: draftSnap.data()! };
      }

      tx.set(
        draftRef,
        {
          ownerUid: uid,
          storagePath,
          status: "processing",
          submitted: false,
          ...(draftSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { action, data: null };
    });

    if (claim.action === "reuse" && claim.data) {
      return responseFromDraft(draftId, claim.data);
    }

    try {
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      const [metadataResult] = await file.getMetadata();
      const contentType = String(metadataResult.contentType ?? "");
      const fileSize = Number(metadataResult.size ?? 0);

      if (!isImageType(contentType)) {
        throw new HttpsError("invalid-argument", "Not a supported image type.");
      }
      if (fileSize > MAX_FILE_SIZE) {
        throw new HttpsError(
          "invalid-argument",
          `File too large (${(fileSize / 1024 / 1024).toFixed(1)} MB).`,
        );
      }

      await checkRateLimit(uid);

      const [rawBuffer] = await file.download();
      const { buffer, contentType: processedType } = await downscaleImage(rawBuffer, contentType);
      const imageBase64 = buffer.toString("base64");
      const extractionResult = await extractMatchFromImage({
        imageBase64,
        mediaType: processedType,
        model: ANTHROPIC_MODEL,
        apiKey: ANTHROPIC_API_KEY.value(),
      });

      await db.runTransaction(async (tx) => {
        const current = await tx.get(draftRef);
        const data = current.exists ? (current.data() as DraftState) : null;
        if (
          !data ||
          data.ownerUid !== uid ||
          data.storagePath !== storagePath ||
          data.status !== "processing"
        ) {
          throw new HttpsError("failed-precondition", "This AI draft is no longer active.");
        }
        tx.set(
          draftRef,
          {
            status: "done",
            raw: extractionResult,
            confidence: extractionResult.confidence,
            requiresReview: extractionResult.requiresReview,
            flags: extractionResult.flags,
            model: ANTHROPIC_MODEL,
            extractedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      return responseFromDraft(draftId, { raw: extractionResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(draftRef);
        const data = current.exists ? (current.data() as DraftState) : null;
        if (
          data?.ownerUid === uid &&
          data.storagePath === storagePath &&
          data.status === "processing"
        ) {
          tx.set(
            draftRef,
            {
              status: "failed",
              error: message,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `Extraction failed: ${message}`);
    }
  },
);
