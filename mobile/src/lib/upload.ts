import { storage, db } from "./firebase";
import { ref, uploadBytes } from "firebase/storage";
import { collection, doc } from "firebase/firestore";

const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12 MB
const ALLOWED_TYPES = ["image/jpeg"];

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

export function buildStoragePath(uid: string, draftId: string): string {
  return `match-photos/${uid}/${draftId}/source.jpg`;
}

function validateFile(size: number, mimeType: string | undefined): void {
  if (!mimeType || !ALLOWED_TYPES.includes(mimeType)) {
    throw new UploadError("invalid_type", "The selected photo could not be converted to JPEG.");
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
  const draftId = generateDraftId();
  const storagePath = buildStoragePath(uid, draftId);

  const response = await fetch(uri);
  if (!response.ok) throw new UploadError("fetch_failed", "Could not read the selected image.");
  const blob = await response.blob();
  validateFile(fileSize ?? blob.size, mimeType ?? blob.type);

  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, {
    contentType: "image/jpeg",
    customMetadata: { owner_uid: uid, draft_id: draftId, uploaded_at: new Date().toISOString() },
  });

  return { draftId, storagePath };
}
