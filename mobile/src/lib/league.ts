import {
  addDoc,
  collection,
  getDocs,
  limit,
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

function asDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") return new Date(value);
  return new Date(0);
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

export async function getPendingConfirmations(uid: string): Promise<PendingMatch[]> {
  const snap = await getDocs(
    query(collection(db, "matches"), where("status", "==", "pending_confirmation")),
  );
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
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
    })
    .filter((match) => (match.aId === uid || match.bId === uid) && match.submittedBy !== uid)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
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

export function previewElo(myElo: number, opponentElo: number, myGoals: number, opponentGoals: number) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
  const score = myGoals > opponentGoals ? 1 : myGoals < opponentGoals ? 0 : 0.5;
  return Math.round(32 * (score - expected));
}
