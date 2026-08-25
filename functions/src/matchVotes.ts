/**
 * Per-match MVP peer votes.
 *
 * Participants of a CONFIRMED league match (finals excluded — those sit outside the ELO/POTM
 * world entirely) can vote for the man of the match within 48 hours of confirmation. Either
 * participant is a valid candidate, but nobody may vote for themselves. A re-vote inside the
 * window replaces the voter's previous choice. Every member can read the individual vote docs;
 * the running tally is maintained by this module in an aggregate doc.
 *
 * Where the aggregate lives: `matchVotes/{matchId}/votes/_summary`. Deliberate placement:
 * - Top-level `matchVotes/{matchId}` is NOT covered by the votes-subcollection rule — the
 *   catch-all `match /{document=**} { allow read, write: if false }` default-denies it, so
 *   clients could never read a summary stored there.
 * - As a doc INSIDE `votes/`, `_summary` inherits the member-wide `allow read`.
 * - Writes stay function-only for two independent reasons: every write rule requires the
 *   doc-id path segment to equal the caller's uid (`voterId == uid()` — no auth uid can ever
 *   equal the literal "_summary"), and the key allowlist (`voterId/candidateId/createdAt`)
 *   excludes a tally-shaped payload. The Admin SDK bypasses rules, so the function writes it.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loggedOnCall } from "./logging";
import { requireAuth, assertMember } from "./auth";

/** Voting stays open this long after a match is confirmed. */
export const VOTE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Doc id of the function-maintained tally inside each `matchVotes/{matchId}/votes` collection. */
export const VOTE_SUMMARY_DOC_ID = "_summary";

/** Why `uid` may NOT vote on this match, or null if the vote may proceed. */
export type CastVoteRejection =
  | "not_participant"
  | "self_vote"
  | "unknown_candidate"
  | "finals_match"
  | "not_confirmed"
  | "no_confirmation_time"
  | "window_closed";

/**
 * Pure decision for one vote attempt. No Firestore dependency, so it is unit-testable; the
 * callable maps the result to an HttpsError. Checks are ordered authorization-first: a
 * non-participant learns nothing about the match's state, mirroring responderRejection.
 */
export function castVoteRejection(
  match: {
    status?: unknown;
    finals?: unknown;
    confirmedAt?: unknown;
    aId?: unknown;
    bId?: unknown;
  },
  uid: string,
  candidateId: string,
  nowMillis: number,
): CastVoteRejection | null {
  const aId = typeof match.aId === "string" ? match.aId : "";
  const bId = typeof match.bId === "string" ? match.bId : "";
  if (uid !== aId && uid !== bId) return "not_participant";
  if (candidateId === uid) return "self_vote";
  if (candidateId !== aId && candidateId !== bId) return "unknown_candidate";
  // Finals advance the bracket and never touch ELO/POTM territory — no MVP vote either.
  if (match.finals === true) return "finals_match";
  if (match.status !== "confirmed") return "not_confirmed";
  const confirmedMs = timestampMillis(match.confirmedAt);
  // No readable confirmation stamp → the window can't be proven open. Same philosophy as
  // canAutoConfirm: un-ageable means CLOSED, never "wide open".
  if (confirmedMs === null) return "no_confirmation_time";
  // Open through the full 48th hour; the moment it elapses the window is shut.
  if (nowMillis - confirmedMs >= VOTE_WINDOW_MS) return "window_closed";
  return null;
}

/** Coerce a Firestore Timestamp (duck-typed, so admin and client Timestamps both work) or an
 *  ISO string to epoch millis. Returns null — never 0 — when the value can't be read, so
 *  callers distinguish "missing" from the epoch. Local copy of matchRules.dateMillisOf to
 *  keep this module dependency-free. */
function timestampMillis(value: unknown): number | null {
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

export interface VoteRowLike {
  /** Vote doc id — the voter's uid, or `_summary` for the aggregate doc. */
  id: string;
  candidateId: unknown;
}

/**
 * Fold the caller's new vote into a match's existing vote docs, producing one candidate id
 * per participating voter: the caller's previous vote (a permitted re-vote) is REPLACED, the
 * `_summary` aggregate doc is skipped, and any prior doc with a non-string candidateId (only
 * writable by a rogue direct client — rules constrain keys, not that value) is dropped.
 */
export function mergedVoteCandidates(
  existing: ReadonlyArray<VoteRowLike>,
  voterId: string,
  candidateId: string,
): string[] {
  const prior = existing
    .filter((row) => row.id !== voterId && row.id !== VOTE_SUMMARY_DOC_ID)
    .filter((row) => typeof row.candidateId === "string")
    .map((row) => row.candidateId as string);
  return [...prior, candidateId];
}

export interface VoteTally {
  /** Votes per candidate id. */
  tally: Record<string, number>;
  /** The outright leader, or null on a tie (including no votes at all) — UI shows "Tie". */
  leaderId: string | null;
  /** Number of votes counted (strays excluded when `validCandidates` is given). */
  totalVotes: number;
}

/**
 * Tally candidate ids into the summary shape. When `validCandidates` is provided, votes for
 * anything else are ignored entirely — a stray value can inflate nothing and never elect a
 * leader. Ties (and empty tallies) yield leaderId null.
 */
export function computeVoteTally(
  candidateIds: ReadonlyArray<string>,
  validCandidates?: ReadonlyArray<string>,
): VoteTally {
  const allowed = validCandidates ? new Set(validCandidates) : null;
  const tally: Record<string, number> = {};
  let totalVotes = 0;
  for (const id of candidateIds) {
    if (allowed && !allowed.has(id)) continue;
    tally[id] = (tally[id] ?? 0) + 1;
    totalVotes++;
  }
  let leaderId: string | null = null;
  let best = 0;
  let tied = false;
  for (const [id, count] of Object.entries(tally)) {
    if (count > best) {
      best = count;
      leaderId = id;
      tied = false;
    } else if (count === best) {
      tied = true;
    }
  }
  return { tally, leaderId: tied || best === 0 ? null : leaderId, totalVotes };
}

/** Map a pure rejection to its client-facing error, authorization failures first. */
function rejectionToError(rejection: CastVoteRejection): HttpsError {
  switch (rejection) {
    case "not_participant":
      return new HttpsError("permission-denied", "Only the two participants can vote.");
    case "self_vote":
      return new HttpsError("invalid-argument", "You can't vote for yourself.");
    case "unknown_candidate":
      return new HttpsError("invalid-argument", "That player isn't in this match.");
    case "finals_match":
      return new HttpsError("failed-precondition", "Finals matches don't have MVP voting.");
    case "not_confirmed":
      return new HttpsError("failed-precondition", "Only confirmed matches can be voted on.");
    case "no_confirmation_time":
    case "window_closed":
      return new HttpsError("failed-precondition", "Voting closed — the 48-hour window has ended.");
  }
}

/**
 * Cast (or replace) the caller's MVP vote for a match, then refresh the tally — atomically,
 * so two concurrent voters can never leave the summary behind either of their writes.
 */
export const castVote = loggedOnCall("castVote", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertMember(uid);
  const matchId = String(req.data?.matchId ?? "").trim();
  const candidateId = String(req.data?.candidateId ?? "").trim();
  if (!matchId) throw new HttpsError("invalid-argument", "A match id is required.");
  if (!candidateId) throw new HttpsError("invalid-argument", "A candidate id is required.");

  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const matchSnap = await tx.get(db.doc(`matches/${matchId}`));
    if (!matchSnap.exists) throw new HttpsError("not-found", "Match not found.");
    const matchData = matchSnap.data()!;
    const rejection = castVoteRejection(matchData, uid, candidateId, Date.now());
    if (rejection) throw rejectionToError(rejection);

    const votesCol = db.collection(`matchVotes/${matchId}/votes`);
    // Read BEFORE writing: queries inside a transaction see a consistent snapshot but not
    // this transaction's own writes, so the new vote is folded in by hand below.
    const existing = await tx.get(votesCol);
    const prior = existing.docs.map((voteDoc) => ({
      id: voteDoc.id,
      candidateId: voteDoc.get("candidateId"),
    }));

    tx.set(votesCol.doc(uid), {
      voterId: uid,
      candidateId,
      createdAt: FieldValue.serverTimestamp(),
    });
    const summary = computeVoteTally(mergedVoteCandidates(prior, uid, candidateId), [
      String(matchData.aId),
      String(matchData.bId),
    ]);
    tx.set(votesCol.doc(VOTE_SUMMARY_DOC_ID), {
      ...summary,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});
