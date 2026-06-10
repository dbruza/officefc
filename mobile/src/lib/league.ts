import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { LEAGUE_ID } from "./constants";
import type { MatchResult, Player } from "@/types";
import type { Role } from "./profiles";

export interface Season {
  id: string;
  name: string;
  year: number;
  start: Date;
  end: Date;
  active: boolean;
}

export interface SeasonResult {
  seasonId: string;
  championId: string;
  runnerUpId: string;
  finalizedAt: Date | null;
}

export interface PotmResult {
  month: string;
  playerId: string;
}

export interface Team {
  id: string;
  name: string;
}

export interface LeaguePlayer extends Player {
  role: Role;
}

export interface Standing {
  uid: string;
  rank: number;
  elo: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  form: MatchResult[];
  move: number;
}

export interface PendingMatch {
  id: string;
  seasonId: string;
  submittedBy: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  status: "pending_confirmation";
  date: Date | null;
}

export interface LeagueMatch {
  id: string;
  seasonId: string;
  submittedBy: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  status: "pending_confirmation" | "confirmed" | "disputed" | "voided";
  source: "manual" | "ai_assisted";
  date: Date | null;
  photoPath: string | null;
  aEloBefore: number | null;
  aEloAfter: number | null;
  aDelta: number | null;
  bEloBefore: number | null;
  bEloAfter: number | null;
  bDelta: number | null;
  aStats?: MatchSideStats;
  bStats?: MatchSideStats;
}

export interface MatchSideStats {
  possession?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
}

export interface EloHistoryPoint {
  matchId: string | null;
  date: Date;
  rating: number;
}

export interface BiggestWin {
  matchId: string;
  opponentId: string;
  goalsFor: number;
  goalsAgainst: number;
  margin: number;
}

export interface PlayerStats {
  uid: string;
  w: number;
  d: number;
  l: number;
  games: number;
  gf: number;
  ga: number;
  winRate: number;
  currentStreak: number;
  currentStreakType: MatchResult | null;
  longestWin: number;
  longestUnbeaten: number;
  biggestWin: BiggestWin | null;
  nemesis: {
    opponentId: string;
    wins: number;
    draws: number;
    losses: number;
    games: number;
  } | null;
}

export interface H2HMeeting {
  matchId: string;
  seasonId: string;
  date: Date | null;
  aGoals: number;
  bGoals: number;
  aDelta: number;
  bDelta: number;
}

export interface HeadToHead {
  pairKey: string;
  aId: string;
  bId: string;
  aWins: number;
  bWins: number;
  draws: number;
  aGoals: number;
  bGoals: number;
  meetings: H2HMeeting[];
}

function asDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") return new Date(value);
  return new Date(0);
}

function asNullableDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
  };
}

export async function getActiveSeason(): Promise<Season | null> {
  const snap = await getDocs(
    query(collection(db, "seasons"), where("active", "==", true), limit(1)),
  );
  const doc = snap.docs[0];
  if (!doc) return null;
  const data = doc.data();
  return {
    id: doc.id,
    name: String(data.name),
    year: Number(data.year),
    start: asDate(data.start),
    end: asDate(data.end),
    active: true,
  };
}

export async function getSeasons(): Promise<Season[]> {
  const snap = await getDocs(collection(db, "seasons"));
  return snap.docs
    .map((seasonDoc) => {
      const data = seasonDoc.data();
      return {
        id: seasonDoc.id,
        name: String(data.name),
        year: Number(data.year),
        start: asDate(data.start),
        end: asDate(data.end),
        active: data.active === true,
      };
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime());
}

export async function getSeason(seasonId: string): Promise<Season | null> {
  const snap = await getDoc(doc(db, "seasons", seasonId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    name: String(data.name),
    year: Number(data.year),
    start: asDate(data.start),
    end: asDate(data.end),
    active: data.active === true,
  };
}

export async function getTeams(): Promise<Team[]> {
  const snap = await getDocs(query(collection(db, "teams"), where("active", "==", true)));
  return snap.docs
    .map((doc) => ({ id: doc.id, name: String(doc.get("name")) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLeaguePlayers(): Promise<LeaguePlayer[]> {
  const [memberSnap, profileSnap] = await Promise.all([
    getDocs(collection(db, "leagues", LEAGUE_ID, "members")),
    getDocs(collection(db, "profiles")),
  ]);
  const roles = new Map(memberSnap.docs.map((doc) => [doc.id, doc.get("role") as Role]));

  return profileSnap.docs
    .filter((doc) => roles.has(doc.id))
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.displayName),
        handle: String(data.handle ?? ""),
        jersey: Number(data.jersey ?? 0),
        color: String(data.color ?? "#00ff87"),
        role: roles.get(doc.id) ?? "member",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getStandings(seasonId: string): Promise<Standing[]> {
  const snap = await getDocs(collection(db, "seasons", seasonId, "standings"));
  return snap.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }) as Standing)
    .sort((a, b) => a.rank - b.rank);
}

export async function getEloHistory(seasonId: string, uid: string): Promise<EloHistoryPoint[]> {
  const snap = await getDoc(doc(db, "seasons", seasonId, "eloHistory", uid));
  if (!snap.exists()) return [];
  const points = snap.get("points");
  if (!Array.isArray(points)) return [];
  return points.map((point) => ({
    matchId: typeof point.matchId === "string" ? point.matchId : null,
    date: asDate(point.date),
    rating: Number(point.rating),
  }));
}

export async function getPlayerStats(uid: string): Promise<PlayerStats | null> {
  const snap = await getDoc(doc(db, "playerStats", uid));
  return snap.exists() ? (snap.data() as PlayerStats) : null;
}

export function h2hPairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join("__");
}

function mapHeadToHead(id: string, data: Record<string, unknown>): HeadToHead {
  const meetings = Array.isArray(data.meetings) ? data.meetings : [];
  return {
    pairKey: id,
    aId: String(data.aId),
    bId: String(data.bId),
    aWins: Number(data.aWins),
    bWins: Number(data.bWins),
    draws: Number(data.draws),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    meetings: meetings.map((meeting) => ({
      matchId: String(meeting.matchId),
      seasonId: String(meeting.seasonId),
      date: asNullableDate(meeting.date),
      aGoals: Number(meeting.aGoals),
      bGoals: Number(meeting.bGoals),
      aDelta: Number(meeting.aDelta ?? 0),
      bDelta: Number(meeting.bDelta ?? 0),
    })),
  };
}

export async function getHeadToHead(aId: string, bId: string): Promise<HeadToHead | null> {
  const snap = await getDoc(doc(db, "h2h", h2hPairKey(aId, bId)));
  if (!snap.exists()) return null;
  return mapHeadToHead(snap.id, snap.data());
}

export async function getHeadToHeadsForPlayer(uid: string): Promise<HeadToHead[]> {
  const snap = await getDocs(collection(db, "h2h"));
  return snap.docs
    .filter((h2hDoc) => h2hDoc.get("aId") === uid || h2hDoc.get("bId") === uid)
    .map((h2hDoc) => mapHeadToHead(h2hDoc.id, h2hDoc.data()));
}

export async function getMatch(matchId: string): Promise<LeagueMatch | null> {
  const snap = await getDoc(doc(db, "matches", matchId));
  return snap.exists() ? mapMatch(snap.id, snap.data()) : null;
}

export async function getSeasonResult(seasonId: string): Promise<SeasonResult | null> {
  const snap = await getDoc(doc(db, "seasonResults", seasonId));
  if (!snap.exists()) return null;
  return {
    seasonId,
    championId: String(snap.get("championId")),
    runnerUpId: String(snap.get("runnerUpId")),
    finalizedAt: asNullableDate(snap.get("finalizedAt")),
  };
}

export async function getSeasonPotm(seasonId: string): Promise<PotmResult[]> {
  const snap = await getDocs(collection(db, "seasonResults", seasonId, "potm"));
  return snap.docs
    .map((potmDoc) => ({ month: potmDoc.id, playerId: String(potmDoc.get("playerId")) }))
    .sort((a, b) => a.month.localeCompare(b.month));
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

export async function getPendingConfirmations(uid: string): Promise<PendingMatch[]> {
  const snap = await getDocs(
    query(collection(db, "matches"), where("status", "==", "pending_confirmation")),
  );
  return pendingForUser(
    snap.docs.map((doc) => mapPendingMatch(doc.id, doc.data())),
    uid,
  );
}

export function subscribePendingConfirmations(
  uid: string,
  onMatches: (matches: PendingMatch[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "matches"), where("status", "==", "pending_confirmation")),
    (snapshot) => {
      const matches = pendingForUser(
        snapshot.docs.map((matchDoc) => mapPendingMatch(matchDoc.id, matchDoc.data())),
        uid,
      );
      onMatches(matches);
    },
    (error) => onError?.(error),
  );
}

export interface SubmitMatchInput {
  seasonId: string;
  submittedBy: string;
  opponentId: string;
  myTeam: Team;
  opponentTeam: Team;
  myGoals: number;
  opponentGoals: number;
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

export async function ensureLeagueSetup(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, { ok: boolean }>(
    functions,
    "ensureLeagueSetup",
  );
  await callable({});
}

export async function seedTeams(): Promise<{ seeded: number; removed: number }> {
  const callable = httpsCallable<
    Record<string, never>,
    { ok: boolean; seeded: number; removed: number }
  >(functions, "seedTeams");
  const result = await callable({});
  return result.data;
}

export async function rebuildLeagueReadModels(): Promise<{
  seasonCount: number;
  matchCount: number;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    { ok: boolean; seasonCount: number; matchCount: number }
  >(functions, "rebuildLeagueReadModels");
  const result = await callable({});
  return result.data;
}

// Mirrors functions/src/elo.ts — the server is the source of truth for ratings.
const ELO_K = 32;
const ELO_SCALE = 400;

/**
 * Approximate the ELO delta for a result, for live UI preview only. This uses a plain
 * win/draw/loss score; the committed rating comes from the server's stats-aware
 * performanceScore (goals + shots-on-target + possession), so the preview can differ slightly.
 */
export function previewElo(
  myElo: number,
  opponentElo: number,
  myGoals: number,
  opponentGoals: number,
) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / ELO_SCALE));
  const score = myGoals > opponentGoals ? 1 : myGoals < opponentGoals ? 0 : 0.5;
  return Math.round(ELO_K * (score - expected));
}

// --- M4 / AI-assisted match logging ---

export interface AiAssistedSubmitInput {
  draftId: string;
  seasonId: string;
  opponentId: string;
  mySide: "home" | "away";
  myTeamId: string;
  opponentTeamId: string;
  submittedGoalsAndStats: {
    myGoals: number;
    opponentGoals: number;
    myPossession?: number | null;
    opponentPossession?: number | null;
    myShots?: number | null;
    opponentShots?: number | null;
    myShotsOnTarget?: number | null;
    opponentShotsOnTarget?: number | null;
  };
}

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

// --- M5 — Season lifecycle & admin ---

export async function finalizeSeason(
  seasonId: string,
  force = false,
): Promise<{ championId: string | null; runnerUpId: string | null; potmCount: number }> {
  const callable = httpsCallable<
    { seasonId: string; force?: boolean },
    { ok: boolean; championId: string | null; runnerUpId: string | null; potmCount: number }
  >(functions, "finalizeSeason");
  const result = await callable({ seasonId, force });
  return result.data;
}

export async function createSeason(
  name: string,
  start: string,
  end: string,
): Promise<{ seasonId: string }> {
  const callable = httpsCallable<
    { name: string; start: string; end: string },
    { ok: boolean; seasonId: string }
  >(functions, "createSeason");
  const result = await callable({ name, start, end });
  return result.data;
}

export async function activateSeason(seasonId: string): Promise<{ seasonId: string }> {
  const callable = httpsCallable<{ seasonId: string }, { ok: boolean; seasonId: string }>(
    functions,
    "activateSeason",
  );
  const result = await callable({ seasonId });
  return result.data;
}

export async function manageTeam(
  action: "add",
  name: string,
): Promise<{ teamId: string; name: string }>;
export async function manageTeam(
  action: "rename" | "deactivate",
  teamId: string,
  name?: string,
): Promise<{ teamId: string }>;
export async function manageTeam(
  action: string,
  teamIdOrName: string,
  name?: string,
): Promise<Record<string, string>> {
  const callable = httpsCallable<Record<string, string>, Record<string, string>>(
    functions,
    "manageTeam",
  );
  const data: Record<string, string> = { action };
  if (action === "add") data.name = teamIdOrName;
  else {
    data.teamId = teamIdOrName;
    if (name) data.name = name;
  }
  const result = await callable(data);
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

export async function listSeasons(): Promise<
  Array<{ id: string; name: string; active: boolean; finalized: boolean }>
> {
  const callable = httpsCallable<
    Record<string, never>,
    Array<{ id: string; name: string; active: boolean; finalized: boolean }>
  >(functions, "listSeasons");
  const result = await callable({});
  return result.data;
}

export interface AdminPendingMatch {
  id: string;
  status: "pending_confirmation" | "disputed";
  submittedBy: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  aTeam: string;
  bTeam: string;
  date: Date | null;
  source: "manual" | "ai_assisted";
  photoPath: string | null;
  disputedBy: string | null;
  disputeReason: string | null;
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
