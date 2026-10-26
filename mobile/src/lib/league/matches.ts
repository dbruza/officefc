import { mutate, invalidateData } from "../dataCache";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  or,
  and,
  orderBy,
  limit,
  startAfter,
  documentId,
  type QueryDocumentSnapshot,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { timed } from "../logger";
import { asNullableDate, nullableNumber } from "./firestoreMap";
import { PENDING_LIMIT_MESSAGES, pendingLimitBreach } from "../matchPolicy";
import type {
  AdminPendingMatch,
  AiAssistedSubmitInput,
  EloExplain,
  LeagueMatch,
  MatchSideStats,
  PendingMatch,
  SubmitMatchInput,
} from "./types";

function sideStats(data: Record<string, unknown>, side: "a" | "b"): MatchSideStats | undefined {
  const nested = data[`${side}Stats`];
  if (nested && typeof nested === "object") {
    const stats = nested as Record<string, unknown>;
    return {
      possession: nullableNumber(stats.possession),
      shots: nullableNumber(stats.shots),
      shotsOnTarget: nullableNumber(stats.shotsOnTarget ?? stats.shots_on_target),
      xg: nullableNumber(stats.xg),
      saves: nullableNumber(stats.saves),
      ballRecoveryTime: nullableNumber(stats.ballRecoveryTime ?? stats.ball_recovery_time),
    };
  }
  const possession = nullableNumber(data[`${side}Possession`]);
  const shots = nullableNumber(data[`${side}Shots`]);
  const shotsOnTarget = nullableNumber(data[`${side}ShotsOnTarget`]);
  const xg = nullableNumber(data[`${side}Xg`]);
  const saves = nullableNumber(data[`${side}Saves`]);
  const ballRecoveryTime = nullableNumber(data[`${side}BallRecoveryTime`]);
  return [possession, shots, shotsOnTarget, xg, saves, ballRecoveryTime].some((v) => v !== null)
    ? { possession, shots, shotsOnTarget, xg, saves, ballRecoveryTime }
    : undefined;
}

function mapEloExplain(data: Record<string, unknown>): EloExplain | undefined {
  const nested = data.eloExplain;
  if (!nested || typeof nested !== "object") return undefined;
  const e = nested as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    aExpected: num(e.aExpected),
    bExpected: num(e.bExpected),
    perfA: num(e.perfA),
    perfB: num(e.perfB),
    aTeamAdj: num(e.aTeamAdj),
    bTeamAdj: num(e.bTeamAdj),
    aPremierAdj: num(e.aPremierAdj),
    bPremierAdj: num(e.bPremierAdj),
    aK: num(e.aK),
    bK: num(e.bK),
  };
}

function mapMatch(id: string, data: Record<string, unknown>): LeagueMatch {
  return {
    id,
    seasonId: String(data.seasonId),
    finals: data.finals === true,
    submittedBy: String(data.submittedBy),
    aId: String(data.aId),
    bId: String(data.bId),
    aTeamId: String(data.aTeamId),
    bTeamId: String(data.bTeamId),
    aTeam: String(data.aTeam),
    bTeam: String(data.bTeam),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    status: String(data.status) as LeagueMatch["status"],
    source: data.source === "ai_assisted" ? "ai_assisted" : "manual",
    date: asNullableDate(data.date),
    photoPath: typeof data.photoPath === "string" ? data.photoPath : null,
    aEloBefore: nullableNumber(data.aEloBefore),
    aEloAfter: nullableNumber(data.aEloAfter),
    aDelta: nullableNumber(data.aDelta),
    bEloBefore: nullableNumber(data.bEloBefore),
    bEloAfter: nullableNumber(data.bEloAfter),
    bDelta: nullableNumber(data.bDelta),
    aStats: sideStats(data, "a"),
    bStats: sideStats(data, "b"),
    eloExplain: mapEloExplain(data),
    autoConfirmAt: asNullableDate(data.autoConfirmDueAt),
    resolvedBy: typeof data.resolvedBy === "string" ? data.resolvedBy : null,
    resolutionReason: typeof data.resolutionReason === "string" ? data.resolutionReason : null,
  };
}

export async function getMatch(matchId: string): Promise<LeagueMatch | null> {
  const snap = await getDoc(doc(db, "matches", matchId));
  return snap.exists() ? mapMatch(snap.id, snap.data()) : null;
}

/** Confirmed matches of a season, oldest first. Equality-only filters (no composite index). */
export async function getSeasonMatches(seasonId: string): Promise<LeagueMatch[]> {
  const snap = await getDocs(
    query(
      collection(db, "matches"),
      where("seasonId", "==", seasonId),
      where("status", "==", "confirmed"),
    ),
  );
  return snap.docs
    .map((matchDoc) => mapMatch(matchDoc.id, matchDoc.data()))
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

/** A player's confirmed matches across all seasons, oldest first. */
export async function getPlayerMatches(uid: string): Promise<LeagueMatch[]> {
  return timed("getPlayerMatches", async () => {
    const matchesCol = collection(db, "matches");
    const [aSnap, bSnap] = await Promise.all([
      getDocs(query(matchesCol, where("aId", "==", uid), where("status", "==", "confirmed"))),
      getDocs(query(matchesCol, where("bId", "==", uid), where("status", "==", "confirmed"))),
    ]);
    return [...aSnap.docs, ...bSnap.docs]
      .map((matchDoc) => mapMatch(matchDoc.id, matchDoc.data()))
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  });
}

function mapPendingMatch(id: string, data: Record<string, unknown>): PendingMatch {
  return {
    ...mapMatch(id, data),
    id,
    seasonId: String(data.seasonId),
    submittedBy: String(data.submittedBy),
    aId: String(data.aId),
    bId: String(data.bId),
    aTeamId: String(data.aTeamId),
    bTeamId: String(data.bTeamId),
    aTeam: String(data.aTeam),
    bTeam: String(data.bTeam),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    status: "pending_confirmation" as const,
    date: data.date instanceof Timestamp ? data.date.toDate() : null,
  };
}

/** Pending matches the user must act on — their match, not their own submission — newest first. */
function pendingForUser(matches: PendingMatch[], uid: string): PendingMatch[] {
  return matches
    .filter((match) => (match.aId === uid || match.bId === uid) && match.submittedBy !== uid)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

/** Pending matches the user submitted — waiting on the opponent's verdict — newest first. */
function pendingSubmittedBy(matches: PendingMatch[], uid: string): PendingMatch[] {
  return matches
    .filter((match) => match.submittedBy === uid)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

export async function getPendingConfirmations(uid: string): Promise<PendingMatch[]> {
  const snap = await getDocs(
    query(
      collection(db, "matches"),
      and(
        where("status", "==", "pending_confirmation"),
        or(where("aId", "==", uid), where("bId", "==", uid)),
      ),
    ),
  );
  return pendingForUser(
    snap.docs.map((doc) => mapPendingMatch(doc.id, doc.data())),
    uid,
  );
}

export interface PendingBuckets {
  /** Awaiting MY verdict (opponent submitted). */
  incoming: PendingMatch[];
  /** My own submissions awaiting the opponent. */
  outgoing: PendingMatch[];
}

type PendingSubscriber = {
  next: (buckets: PendingBuckets) => void;
  error?: (error: Error) => void;
};
const pendingStreams = new Map<
  string,
  {
    subscribers: Set<PendingSubscriber>;
    latest?: PendingBuckets;
    stop: () => void;
  }
>();

export function subscribePendingConfirmations(
  uid: string,
  onMatches: (buckets: PendingBuckets) => void,
  onError?: (error: Error) => void,
): () => void {
  let stream = pendingStreams.get(uid);
  if (!stream) {
    stream = { subscribers: new Set(), stop: () => {} };
    pendingStreams.set(uid, stream);
    const shared = stream;
    shared.stop = onSnapshot(
      query(
        collection(db, "matches"),
        and(
          where("status", "==", "pending_confirmation"),
          or(where("aId", "==", uid), where("bId", "==", uid)),
        ),
      ),
      (snapshot) => {
        if (shared.latest) invalidateData();
        const all = snapshot.docs.map((row) => mapPendingMatch(row.id, row.data()));
        shared.latest = {
          incoming: pendingForUser(all, uid),
          outgoing: pendingSubmittedBy(all, uid),
        };
        for (const subscriber of shared.subscribers) subscriber.next(shared.latest);
      },
      (error) => {
        if (pendingStreams.get(uid) === shared) pendingStreams.delete(uid);
        for (const subscriber of shared.subscribers) subscriber.error?.(error);
      },
    );
  }
  const shared = stream;
  const subscriber = { next: onMatches, error: onError };
  shared.subscribers.add(subscriber);
  if (shared.latest) onMatches(shared.latest);
  return () => {
    shared.subscribers.delete(subscriber);
    if (shared.subscribers.size === 0) {
      shared.stop();
      if (pendingStreams.get(uid) === shared) pendingStreams.delete(uid);
    }
  };
}

/**
 * Refuse a result the server would void for going over the pending-result limits
 * (functions/src/models/matchPolicy.ts), so the player hears why now instead of seeing the
 * result vanish. The notifyMatchSubmitted trigger stays the authority.
 */
export async function assertWithinPendingLimit(
  submittedBy: string,
  opponentId: string,
): Promise<void> {
  const snap = await getDocs(
    query(
      collection(db, "matches"),
      where("submittedBy", "==", submittedBy),
      where("status", "==", "pending_confirmation"),
    ),
  );
  const pending = snap.docs.map((row) => {
    const data = row.data();
    return { id: row.id, opponentId: String(data.aId === submittedBy ? data.bId : data.aId) };
  });
  const breach = pendingLimitBreach(pending, { opponentId });
  if (breach) {
    throw Object.assign(new Error(PENDING_LIMIT_MESSAGES[breach]), {
      code: "failed-precondition",
    });
  }
}

export async function submitManualMatch(input: SubmitMatchInput): Promise<string> {
  await assertWithinPendingLimit(input.submittedBy, input.opponentId);
  const ref = await addDoc(collection(db, "matches"), {
    seasonId: input.seasonId,
    submittedBy: input.submittedBy,
    aId: input.submittedBy,
    bId: input.opponentId,
    aTeamId: input.myTeam.id,
    bTeamId: input.opponentTeam.id,
    aTeam: input.myTeam.name,
    bTeam: input.opponentTeam.name,
    aGoals: input.myGoals,
    bGoals: input.opponentGoals,
    status: "pending_confirmation",
    source: "manual",
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  invalidateData();
  return ref.id;
}

export async function confirmMatch(matchId: string): Promise<void> {
  const callable = httpsCallable<{ matchId: string }, { ok: boolean }>(functions, "confirmMatch");
  await mutate(() => callable({ matchId }));
}

export async function disputeMatch(matchId: string, reason = ""): Promise<void> {
  const callable = httpsCallable<{ matchId: string; reason: string }, { ok: boolean }>(
    functions,
    "disputeMatch",
  );
  await mutate(() => callable({ matchId, reason }));
}

// --- M4 / AI-assisted match logging ---

export async function submitAiAssistedMatch(
  input: AiAssistedSubmitInput,
): Promise<{ matchId: string }> {
  const callable = httpsCallable<AiAssistedSubmitInput, { ok: boolean; matchId: string }>(
    functions,
    "submitAiAssistedMatch",
  );
  const result = await mutate(() => callable(input));
  return result.data;
}

export async function callExtractMatchStats(
  draftId: string,
  storagePath: string,
  force = false,
): Promise<Record<string, unknown>> {
  const callable = httpsCallable<
    { draftId: string; storagePath: string; force?: boolean },
    Record<string, unknown>
  >(functions, "extractMatchStats");
  const result = await mutate(() => callable({ draftId, storagePath, force }));
  return result.data;
}

export async function getMatchPhotoUrl(
  matchId: string,
): Promise<{ url: string; expiresAt: number }> {
  const callable = httpsCallable<{ matchId: string }, { url: string; expiresAt: number }>(
    functions,
    "getMatchPhotoUrl",
  );
  const result = await callable({ matchId });
  return result.data;
}

export async function deleteMatchPhoto(matchId: string): Promise<void> {
  const callable = httpsCallable<{ matchId: string }, { ok: boolean; matchId: string }>(
    functions,
    "deleteMatchPhoto",
  );
  await mutate(() => callable({ matchId }));
}

export async function abandonMatchDraft(draftId: string): Promise<{ ok: true }> {
  const callable = httpsCallable<{ draftId: string }, { ok: true }>(functions, "abandonMatchDraft");
  const result = await mutate(() => callable({ draftId }));
  return result.data;
}

/** Admin resolve. Voiding a confirmed result needs a reason; the server then reports whether
 *  a cup tie between the pair may need fixing by hand. */
export async function resolveMatch(
  matchId: string,
  action: "confirm" | "correct_confirm" | "void",
  correctedScore?: { aGoals: number; bGoals: number },
  reason?: string,
): Promise<{ matchId: string; cupTieMayNeedRepair?: boolean }> {
  const callable = httpsCallable<
    Record<string, unknown>,
    { ok: boolean; matchId: string; cupTieMayNeedRepair?: boolean }
  >(functions, "resolveMatch");
  const data: Record<string, unknown> = { matchId, action };
  if (reason) data.reason = reason;
  if (correctedScore) data.correctedScore = correctedScore;
  const result = await mutate(() => callable(data));
  return result.data;
}

/** Matches awaiting admin action — disputed first, then pending, newest first. */
export async function getAdminPendingMatches(): Promise<AdminPendingMatch[]> {
  const matchesCol = collection(db, "matches");
  const [pendingSnap, disputedSnap] = await Promise.all([
    getDocs(query(matchesCol, where("status", "==", "pending_confirmation"))),
    getDocs(query(matchesCol, where("status", "==", "disputed"))),
  ]);
  return [...pendingSnap.docs, ...disputedSnap.docs]
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        status:
          data.status === "disputed" ? ("disputed" as const) : ("pending_confirmation" as const),
        submittedBy: String(data.submittedBy),
        aId: String(data.aId),
        bId: String(data.bId),
        aGoals: Number(data.aGoals),
        bGoals: Number(data.bGoals),
        aTeam: String(data.aTeam ?? ""),
        bTeam: String(data.bTeam ?? ""),
        date: asNullableDate(data.date),
        source: data.source === "ai_assisted" ? ("ai_assisted" as const) : ("manual" as const),
        photoPath: typeof data.photoPath === "string" ? data.photoPath : null,
        disputedBy: typeof data.disputedBy === "string" ? data.disputedBy : null,
        disputeReason:
          typeof data.disputeReason === "string" && data.disputeReason ? data.disputeReason : null,
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "disputed" ? -1 : 1;
      return (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
    });
}

export interface MatchPage {
  matches: LeagueMatch[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}
export async function getPlayerMatchPage(
  uid: string,
  cursor: QueryDocumentSnapshot | null = null,
  pageSize = 30,
): Promise<MatchPage> {
  const size = Math.max(1, Math.min(100, pageSize));
  const snapshot = await getDocs(
    query(
      collection(db, "matches"),
      and(where("status", "==", "confirmed"), or(where("aId", "==", uid), where("bId", "==", uid))),
      orderBy("sortDate", "desc"),
      orderBy(documentId(), "desc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size),
    ),
  );
  return {
    matches: snapshot.docs.map((row) => mapMatch(row.id, row.data())),
    cursor: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.size === size,
  };
}
export async function getRecentSeasonMatches(seasonId: string, count = 12): Promise<LeagueMatch[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "matches"),
      where("seasonId", "==", seasonId),
      where("status", "==", "confirmed"),
      orderBy("sortDate", "desc"),
      orderBy(documentId(), "desc"),
      limit(count),
    ),
  );
  return snapshot.docs.map((row) => mapMatch(row.id, row.data())).reverse();
}
