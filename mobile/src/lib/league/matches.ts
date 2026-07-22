import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { timed } from "../logger";
import { asNullableDate, nullableNumber } from "./firestoreMap";
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
    };
  }
  const possession = nullableNumber(data[`${side}Possession`]);
  const shots = nullableNumber(data[`${side}Shots`]);
  const shotsOnTarget = nullableNumber(data[`${side}ShotsOnTarget`]);
  return possession !== null || shots !== null || shotsOnTarget !== null
    ? { possession, shots, shotsOnTarget }
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
    query(collection(db, "matches"), where("status", "==", "pending_confirmation")),
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

export function subscribePendingConfirmations(
  uid: string,
  onMatches: (buckets: PendingBuckets) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "matches"), where("status", "==", "pending_confirmation")),
    (snapshot) => {
      const all = snapshot.docs.map((matchDoc) => mapPendingMatch(matchDoc.id, matchDoc.data()));
      onMatches({ incoming: pendingForUser(all, uid), outgoing: pendingSubmittedBy(all, uid) });
    },
    (error) => onError?.(error),
  );
}

export async function submitManualMatch(input: SubmitMatchInput): Promise<string> {
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
  return ref.id;
}

export async function confirmMatch(matchId: string): Promise<void> {
  const callable = httpsCallable<{ matchId: string }, { ok: boolean }>(functions, "confirmMatch");
  await callable({ matchId });
}

export async function disputeMatch(matchId: string, reason = ""): Promise<void> {
  const callable = httpsCallable<{ matchId: string; reason: string }, { ok: boolean }>(
    functions,
    "disputeMatch",
  );
  await callable({ matchId, reason });
}

// --- M4 / AI-assisted match logging ---

export async function submitAiAssistedMatch(
  input: AiAssistedSubmitInput,
): Promise<{ matchId: string }> {
  const callable = httpsCallable<AiAssistedSubmitInput, { ok: boolean; matchId: string }>(
    functions,
    "submitAiAssistedMatch",
  );
  const result = await callable(input);
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
  const result = await callable({ draftId, storagePath, force });
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
  await callable({ matchId });
}

export async function abandonMatchDraft(draftId: string): Promise<{ ok: true }> {
  const callable = httpsCallable<{ draftId: string }, { ok: true }>(functions, "abandonMatchDraft");
  const result = await callable({ draftId });
  return result.data;
}

export async function resolveMatch(
  matchId: string,
  action: "confirm" | "correct_confirm" | "void",
  correctedScore?: { aGoals: number; bGoals: number },
  reason?: string,
): Promise<{ matchId: string }> {
  const callable = httpsCallable<Record<string, unknown>, { ok: boolean; matchId: string }>(
    functions,
    "resolveMatch",
  );
  const data: Record<string, unknown> = { matchId, action };
  if (reason) data.reason = reason;
  if (correctedScore) data.correctedScore = correctedScore;
  const result = await callable(data);
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
