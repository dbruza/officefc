/**
 * Maps Firebase Auth/Functions errors to friendly, user-facing copy. Raw Firebase text
 * ("FirebaseError: internal", "auth/invalid-credential") should never reach the screen.
 */
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That doesn't look like a valid email.",
  "auth/missing-email": "Enter your email.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/email-already-in-use": "An account already exists for that email. Try signing in.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/user-not-found": "No account found for that email.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-disabled": "This account has been disabled. Ask a league admin for help.",
  "auth/expired-action-code": "That link has expired. Request a new one.",
  "auth/invalid-action-code": "That link is invalid or was already used. Request a new one.",
  "auth/requires-recent-login": "For security, sign out and back in, then try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and retry.",
  // Callable function errors (redeemInvite / season join codes)
  "functions/permission-denied": "You're not allowed to do that.",
  "functions/not-found": "That join code wasn't found.",
  "functions/failed-precondition": "That season is no longer accepting new players.",
  "functions/invalid-argument": "That code doesn't look right. Check it and try again.",
  "functions/resource-exhausted": "Too many attempts. Wait a moment and try again.",
  "functions/unauthenticated": "Please sign in again.",
  "functions/unavailable": "Can't reach the league right now. Check your connection and retry.",
  "functions/deadline-exceeded": "That took too long. Check your connection and retry.",
};

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}

function rawMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message)
    : "";
}

export function authErrorMessage(err: unknown): string {
  return MESSAGES[errorCode(err)] ?? "Something went wrong. Please try again.";
}

/**
 * Generic copy for admin callables (seasons, teams, cup, invite codes). Unlike
 * `authErrorMessage` this never assumes a join-code context.
 */
const CALLABLE_MESSAGES: Record<string, string> = {
  "functions/permission-denied": "You need admin rights to do that.",
  "functions/unauthenticated": "Your session expired. Sign in again.",
  "functions/not-found": "That item no longer exists. Refresh and try again.",
  "functions/already-exists": "That already exists.",
  "functions/invalid-argument": "Some details are missing or invalid.",
  "functions/failed-precondition": "That can't be done right now.",
  "functions/resource-exhausted": "Too many requests. Wait a moment and try again.",
  "functions/unavailable": "Can't reach the server. Check your connection and retry.",
  "functions/deadline-exceeded": "The server took too long to answer. Try again.",
  "functions/internal": "Something went wrong on the server. Try again.",
  "functions/unknown": "Something went wrong on the server. Try again.",
  "auth/network-request-failed": "Network error. Check your connection and retry.",
};

/**
 * Codes whose message is written by our own Cloud Functions for people to read
 * ("Finals have already started.", "A cup needs at least 3 members."), so it's more
 * useful than any generic line. Internal/transport errors carry Firebase's terse code
 * text instead, which is why they map to fixed copy above.
 */
const SERVER_AUTHORED = new Set([
  "functions/failed-precondition",
  "functions/invalid-argument",
  "functions/not-found",
  "functions/already-exists",
  "functions/out-of-range",
  "functions/aborted",
]);

/** Looks like a sentence a person wrote, not a bare code like "internal" or "NOT_FOUND". */
function isHumanSentence(text: string): boolean {
  return /\s/.test(text.trim()) && !/^[A-Z_]+$/.test(text.trim());
}

/** Friendly message for a failed admin callable. Pair it with an action-specific title. */
export function callableErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  const code = errorCode(err);
  const message = rawMessage(err);
  if (SERVER_AUTHORED.has(code) && isHumanSentence(message)) return message;
  return CALLABLE_MESSAGES[code] ?? fallback;
}
