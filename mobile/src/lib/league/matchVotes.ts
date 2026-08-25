/**
 * Per-match MVP peer votes (client side).
 *
 * Members READ the votes subcollection directly (rules allow member-wide reads); WRITES go
 * through the `castVote` callable, which is the sole authority for participation, the
 * no-self-vote rule, finals exclusion and the 48-hour window. The function-maintained tally
 * lives INSIDE the votes collection as doc `_summary` rather than at `matchVotes/{matchId}`
 * top level: the rules cover `matchVotes/{matchId}/votes/{doc}` only, so a top-level summary
 * would be default-deny for reads, while a doc in the subcollection inherits the member-wide
 * read. No client can forge it — every write rule requires the doc id to equal the caller's
 * uid (no auth uid equals "_summary") and constrains the payload keys.
 */
import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

/** Mirrors VOTE_WINDOW_MS in functions/src/matchVotes.ts — kept literal so this module stays
 *  free of any functions/ import (the app never bundles backend source). */
export const VOTE_WINDOW_MS = 48 * 60 * 60 * 1000;

const SUMMARY_DOC_ID = "_summary";

export interface MatchVoteSummary {
  /** Votes per candidate id. */
  tally: Record<string, number>;
  /** Outright leader, or null on a tie (including zero votes) — UI shows "Tie". */
  leaderId: string | null;
  totalVotes: number;
}

export interface MatchVotes {
  summary: MatchVoteSummary;
  /** The viewer's current choice, once they have voted. */
  myCandidateId: string | null;
  /** Epoch millis when voting closes; null when the confirmation stamp can't be read —
   *  callers must treat null as CLOSED (the server refuses the write regardless). */
  closesAt: number | null;
  /** True for finals matches: MVP voting never applies, hide the whole feature. */
  isFinals: boolean;
}

/** Everything the match screen needs for its MVP card. `viewerId` selects whose existing
 *  choice surfaces as `myCandidateId`; pass null when the viewer isn't signed in. */
export async function getMatchVotes(matchId: string, viewerId: string | null): Promise<MatchVotes> {
  const [votesSnap, matchSnap] = await Promise.all([
    getDocs(collection(db, "matchVotes", matchId, "votes")),
    getDoc(doc(db, "matches", matchId)),
  ]);
  const matchData = matchSnap.data() ?? {};

  const summaryDoc = votesSnap.docs.find((voteDoc) => voteDoc.id === SUMMARY_DOC_ID);
  const myDoc = viewerId ? votesSnap.docs.find((voteDoc) => voteDoc.id === viewerId) : undefined;
  // Fallback recount filters to the match's two participants, mirroring the server's
  // tally filter — a stray/foreign candidateId must never render or inflate totalVotes.
  const validCandidates = [matchData.aId, matchData.bId].filter(
    (value): value is string => typeof value === "string",
  );
  const summary = summaryDoc
    ? readSummary(summaryDoc.data())
    : recountFromVotes(votesSnap.docs, validCandidates);

  return {
    summary,
    myCandidateId:
      typeof myDoc?.data().candidateId === "string" ? String(myDoc!.data().candidateId) : null,
    closesAt: voteClosesAtMillis(matchData.confirmedAt),
    isFinals: matchData.finals === true,
  };
}

/** Record (or replace) the caller's MVP vote. Throws the callable's HttpsError codes. */
export async function castVote(matchId: string, candidateId: string): Promise<void> {
  const callable = httpsCallable<{ matchId: string; candidateId: string }, { ok: boolean }>(
    functions,
    "castVote",
  );
  await callable({ matchId, candidateId });
}

/** Epoch millis at which voting closes, or null without a readable confirmation stamp. */
function voteClosesAtMillis(confirmedAt: unknown): number | null {
  const ms =
    confirmedAt instanceof Timestamp ? confirmedAt.toMillis() : parseEpochMillis(confirmedAt);
  return ms === null ? null : ms + VOTE_WINDOW_MS;
}

function parseEpochMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Coerce the summary doc's payload defensively — a malformed doc degrades to a recount. */
function readSummary(data: Record<string, unknown>): MatchVoteSummary {
  const rawTally = data.tally;
  const tally: Record<string, number> = {};
  if (rawTally && typeof rawTally === "object") {
    for (const [id, count] of Object.entries(rawTally)) {
      if (typeof count === "number" && Number.isFinite(count)) tally[id] = count;
    }
  }
  const leaderId = typeof data.leaderId === "string" ? data.leaderId : null;
  const totalVotes =
    typeof data.totalVotes === "number" && Number.isFinite(data.totalVotes)
      ? data.totalVotes
      : Object.values(tally).reduce((sum, count) => sum + count, 0);
  return { tally, leaderId, totalVotes };
}

/** Client-side fallback tally straight off the vote docs (summary write not landed yet).
 *  Only votes naming one of `validCandidates` (the match's two participants) count —
 *  same filter the server applies, so junk rows can't skew the UI either. */
function recountFromVotes(
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>,
  validCandidates: readonly string[],
): MatchVoteSummary {
  const tally: Record<string, number> = {};
  for (const voteDoc of docs) {
    if (voteDoc.id === SUMMARY_DOC_ID) continue;
    const candidateId = voteDoc.data().candidateId;
    if (
      typeof candidateId === "string" &&
      (validCandidates as readonly string[]).includes(candidateId)
    ) {
      tally[candidateId] = (tally[candidateId] ?? 0) + 1;
    }
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
  const totalVotes = Object.values(tally).reduce((sum, count) => sum + count, 0);
  return { tally, leaderId: tied ? null : leaderId, totalVotes };
}
