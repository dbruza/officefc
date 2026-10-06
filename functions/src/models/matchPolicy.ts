/**
 * Pure match-submission policy shared by Cloud Functions and the app: how long the named
 * opponent has before an undisputed result confirms on their behalf, and how many
 * unconfirmed results one player may have outstanding. No Firestore dependency, so both sides
 * quote the same numbers and the unit tests exercise them.
 */

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Dispute window: an undisputed pending match auto-confirms this long after it was submitted,
 * and only when the opponent could be told about it (see autoConfirmMatch). Long enough to
 * cover a working day away from the app.
 */
export const AUTO_CONFIRM_HOURS = 24;

/** Remind the opponent this long after submission, four hours before the window closes.
 *  Must stay below AUTO_CONFIRM_HOURS to be reachable. */
export const REMINDER_HOURS = 20;

/**
 * Matches pending longer than this are treated as abandoned rather than merely unanswered and
 * are left for an admin. Without a floor, the first run after deploy would sweep up every
 * pending match ever accumulated — including results whose season has since been finalized.
 */
export const AUTO_CONFIRM_MAX_AGE_HOURS = 72;

/** When a pending match created at `createdMillis` confirms if nobody responds. */
export function autoConfirmDueMillis(createdMillis: number): number {
  return createdMillis + AUTO_CONFIRM_HOURS * HOUR_MS;
}

/** When the opponent of a pending match created at `createdMillis` is reminded. */
export function reminderDueMillis(createdMillis: number): number {
  return createdMillis + REMINDER_HOURS * HOUR_MS;
}

/**
 * Stored on a pending match that will never auto-confirm because its opponent couldn't be
 * told about it (no push device, or confirmations muted). Deliberately generic: match docs
 * are member-readable and push preferences are private.
 */
export const AUTO_CONFIRM_HOLD = "opponent_unreachable";

/** Most unconfirmed results one player may have waiting on opponents at once. */
export const MAX_PENDING_PER_SUBMITTER = 20;

/** Most unconfirmed results one player may have waiting on the same opponent. */
export const MAX_PENDING_PER_OPPONENT = 8;

export type PendingLimit = "submitter" | "opponent";

export const PENDING_LIMIT_MESSAGES: Readonly<Record<PendingLimit, string>> = {
  submitter: `You already have ${MAX_PENDING_PER_SUBMITTER} results waiting for confirmation. Ask your opponents to confirm or dispute them before you log more.`,
  opponent: `You already have ${MAX_PENDING_PER_OPPONENT} results with this player waiting for confirmation. Ask them to confirm or dispute those before you log more.`,
};

export interface PendingSubmission {
  id: string;
  opponentId: string;
}

/**
 * Which limit a submission breaks, or null when it fits.
 *
 * `pending` is the submitter's own pending results, oldest first, read with a limit of
 * MAX_PENDING_PER_SUBMITTER. A stored submission is judged by its place in that list, so the
 * oldest results keep their place and only the newest are turned away, whatever order
 * concurrent checks run in. A submission that isn't in the list (not stored yet, or more than
 * the limit are ahead of it) is judged as if it came last.
 */
export function pendingLimitBreach(
  pending: readonly PendingSubmission[],
  candidate: { id?: string; opponentId: string },
): PendingLimit | null {
  let position = candidate.id ? pending.findIndex((row) => row.id === candidate.id) : -1;
  if (position === -1) {
    if (pending.length >= MAX_PENDING_PER_SUBMITTER) return "submitter";
    position = pending.length;
  }
  const sameOpponent = pending
    .slice(0, position)
    .filter((row) => row.opponentId === candidate.opponentId).length;
  return sameOpponent >= MAX_PENDING_PER_OPPONENT ? "opponent" : null;
}
