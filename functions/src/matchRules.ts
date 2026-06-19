/**
 * Pure decision for who may respond to a pending match. No Firestore dependency, so it can be
 * unit-tested in isolation; the callable handlers in matchLifecycle.ts map the result to an
 * HttpsError.
 */

export type ResponderRejection = "not_opponent" | "not_pending";

/**
 * Why `uid` may NOT confirm/dispute this match, or null if they may. Only the *named opponent*
 * (a participant who is not the submitter) may respond, and only while the match is still
 * awaiting confirmation.
 */
export function responderRejection(
  data: { aId?: unknown; bId?: unknown; submittedBy?: unknown; status?: unknown },
  uid: string,
): ResponderRejection | null {
  const isParticipant = uid === data.aId || uid === data.bId;
  if (!isParticipant || uid === data.submittedBy) return "not_opponent";
  if (data.status !== "pending_confirmation") return "not_pending";
  return null;
}
