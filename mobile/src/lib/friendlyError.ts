/**
 * Turn a thrown error into copy a player can act on. Firebase surfaces raw codes
 * ("functions/internal", "storage/unauthorized") and terse messages ("internal") that
 * mean nothing on screen, so the match loop maps them here instead of printing
 * `err.message` verbatim.
 */

function codeOf(err: unknown): string {
  return err && typeof err === "object" && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}

/** A deliberate server/validation message reads as a sentence; bare codes don't. */
function isSentence(message: string): boolean {
  return /\s/.test(message.trim()) && message.length <= 200;
}

export function friendlyError(err: unknown, fallback: string): string {
  // Our own picker/upload errors are written for people already.
  if (err instanceof Error && (err.name === "PhotoPickerError" || err.name === "UploadError")) {
    return err.message || fallback;
  }
  const code = codeOf(err);
  const message = err instanceof Error ? err.message : "";
  if (
    code.endsWith("unavailable") ||
    code.endsWith("network-request-failed") ||
    code === "storage/retry-limit-exceeded" ||
    /network|offline|failed to fetch/i.test(message)
  ) {
    return "You seem to be offline. Check your connection and try again.";
  }
  if (code.endsWith("deadline-exceeded")) return "That took too long. Try again in a moment.";
  if (code.endsWith("resource-exhausted")) {
    return "Too many attempts right now. Wait a minute, then try again.";
  }
  if (code.endsWith("unauthenticated")) return "Your session expired. Sign in again, then retry.";
  // Functions throw HttpsErrors with a human sentence for expected rejections ("This match is
  // no longer pending.") — those are worth showing as-is.
  if (
    (code.endsWith("failed-precondition") ||
      code.endsWith("invalid-argument") ||
      code.endsWith("not-found") ||
      code.endsWith("permission-denied") ||
      code.endsWith("already-exists")) &&
    isSentence(message)
  ) {
    return message;
  }
  if (code.endsWith("permission-denied") || code === "storage/unauthorized") {
    return "You don't have permission to do that.";
  }
  return fallback;
}
