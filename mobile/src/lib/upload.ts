import { storage, db } from "./firebase";
import { ref, uploadBytes, deleteObject } from "firebase/storage";
import { collection, doc } from "firebase/firestore";

const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export class UploadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UploadError";
  }
}

export function generateDraftId(): string {
  return doc(collection(db, "matches")).id;
}

export function buildStoragePath(uid: string, draftId: string, extension: string): string {
  return `match-photos/${uid}/${draftId}/source.${extension}`;
}

function inferExtension(uri: string, mimeType?: string): string {
  if (mimeType) {
    const ext = mimeType.split("/")[1];
    if (ext) return ext === "jpeg" ? "jpg" : ext;
  }
  const match = uri.match(/\.(\w+)(\?|$)/);
  return match ? match[1] : "jpg";
}

function validateFile(size: number, mimeType: string | undefined): void {
  if (!mimeType || !ALLOWED_TYPES.includes(mimeType)) {
    throw new UploadError("invalid_type", "Only image files (JPEG, PNG, WebP, HEIC) are accepted.");
  }
  if (size > MAX_FILE_SIZE) {
    throw new UploadError("too_large", `File size ${(size / 1024 / 1024).toFixed(1)} MB exceeds the 12 MB limit.`);
  }
}

export interface UploadResult {
  draftId: string;
  storagePath: string;
}

/**
 * Upload a stats-screen image under the private match-photos namespace.
 * Returns the draftId and storagePath to carry through extraction and submission.
 */
export async function uploadMatchPhoto(
  uid: string,
  uri: string,
  mimeType?: string,
  fileSize?: number,
): Promise<UploadResult> {
  if (fileSize) validateFile(fileSize, mimeType);

  const draftId = generateDraftId();
  const ext = inferExtension(uri, mimeType);
  const storagePath = buildStoragePath(uid, draftId, ext);

  const response = await fetch(uri);
  if (!response.ok) throw new UploadError("fetch_failed", "Could not read the selected image.");
  const blob = await response.blob();

  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, {
    customMetadata: { owner_uid: uid, draft_id: draftId, uploaded_at: new Date().toISOString() },
  });

  return { draftId, storagePath };
}

/** Delete an abandoned draft upload (owner-only per storage rules). */
export async function deleteDraftUpload(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}
