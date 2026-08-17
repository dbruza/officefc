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

/**
 * When a pending match was created, in epoch millis, or null if no field on the document can
 * be aged. This is the ONE resolution of "how old is this match?" — both the scheduler's
 * filter and the confirming transaction call it through `canAutoConfirm`, so they can never
 * disagree about a match's age.
 */
export function matchCreatedMillis(data: { createdAt?: unknown; date?: unknown }): number | null {
  const created = dateMillisOf(data.createdAt);
  if (created !== null) return created;
  return dateMillisOf(data.date);
}

/**
 * Whether a pending match may be auto-confirmed on the opponent's behalf. True only when the
 * match is still awaiting confirmation AND it is not a finals match AND its full dispute window
 * has lapsed (created at or before `cutoffMillis`) AND it is not so old it looks abandoned
 * rather than merely unanswered (`floorMillis`, when given — matches created before it are left
 * for an admin).
 *
 * Age is enforced here rather than only at the query, so the confirming transaction applies
 * the same rule: a match whose timestamp can't be read is skipped instead of being treated as
 * infinitely old and confirmed with no dispute window at all.
 */
export function canAutoConfirm(
  data: { status?: unknown; finals?: unknown; createdAt?: unknown; date?: unknown },
  cutoffMillis: number,
  floorMillis?: number,
): boolean {
  if (data.status !== "pending_confirmation") return false;
  // Finals decide the bracket, and advancing it is a side effect that can't be replayed once
  // the match leaves `pending_confirmation` — a failed advance would strand the bracket with no
  // way to retry. A knockout result is also where the opponent's actual consent matters most,
  // so finals always wait for a human: the opponent confirms, or an admin resolves it.
  if (data.finals === true) return false;
  const createdMs = matchCreatedMillis(data);
  // No ageable stamp → never confirm; we can't prove the dispute window elapsed.
  if (createdMs === null) return false;
  if (createdMs > cutoffMillis) return false;
  if (floorMillis != null && createdMs < floorMillis) return false;
  return true;
}

/** Coerce a Firestore Timestamp (duck-typed, so admin and client Timestamps both work) or a
 *  date string to epoch millis. Returns null — never 0 — when the value can't be aged, so
 *  callers can distinguish "unknown" from the epoch. Local helper to keep this module
 *  dependency-free (mirrors utils.dateMillis, which returns 0 for its own callers). */
function dateMillisOf(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const raw = (value as { toMillis: unknown }).toMillis;
    if (typeof raw === "function") {
      const ms = (value as { toMillis: () => number }).toMillis();
      if (Number.isFinite(ms)) return ms;
    }
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
