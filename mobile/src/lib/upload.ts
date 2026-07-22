import { Platform } from "react-native";
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
    throw new UploadError(
      "too_large",
      `File size ${(size / 1024 / 1024).toFixed(1)} MB exceeds the 12 MB limit.`,
    );
  }
}

export interface UploadResult {
  draftId: string;
  storagePath: string;
}

/**
 * Read a local image URI into a Blob.
 *
 * Native must NOT use fetch(): Expo SDK 56+ replaces global.fetch with expo/fetch, whose
 * Response.blob() assembles the Blob from an ArrayBuffer — React Native's Blob constructor
 * rejects ArrayBuffer parts ("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are
 * not supported"). React Native's XMLHttpRequest still hands back a true native Blob
 * reference, which is also the only payload the Firebase Storage SDK can send from React
 * Native (its multipart body is built via new Blob([string, data, string])).
 */
function readImageAsBlob(uri: string): Promise<Blob> {
  if (Platform.OS === "web") {
    return fetch(uri).then((response) => {
      if (!response.ok) {
        throw new UploadError("fetch_failed", "Could not read the selected image.");
      }
      return response.blob();
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      // file:// responses may report status 0; a present Blob is the real success signal.
      const blob = xhr.response as Blob | null;
      if (blob) resolve(blob);
      else reject(new UploadError("fetch_failed", "Could not read the selected image."));
    };
    xhr.onerror = () =>
      reject(new UploadError("fetch_failed", "Could not read the selected image."));
    xhr.open("GET", uri, true);
    xhr.responseType = "blob";
    xhr.send(null);
  });
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

  const blob = await readImageAsBlob(uri);
  try {
    validateFile(fileSize ?? blob.size, mimeType ?? blob.type);

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob, {
      contentType: "image/jpeg",
      customMetadata: { owner_uid: uid, draft_id: draftId, uploaded_at: new Date().toISOString() },
    });
  } finally {
    // RN blobs pin the full image in native memory until explicitly closed (no-op on web).
    const closable = blob as Blob & { close?: () => void };
    closable.close?.();
  }

  return { draftId, storagePath };
}
