/** Maps Firebase Auth/Functions error codes to friendly, user-facing messages. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That doesn't look like a valid email.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/email-already-in-use": "An account already exists for that email. Try signing in.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/user-not-found": "No account found for that email.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and retry.",
  // Callable function errors (redeemInvite / season join codes)
  "functions/permission-denied": "You're not allowed to do that.",
  "functions/not-found": "That join code wasn't found.",
  "functions/failed-precondition": "That season is no longer accepting new players.",
  "functions/unauthenticated": "Please sign in again.",
};

export function authErrorMessage(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  return MESSAGES[code] ?? "Something went wrong. Please try again.";
}
