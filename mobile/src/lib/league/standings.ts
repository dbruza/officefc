import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { asDate, nullableNumber } from "./firestoreMap";
import type { EloHistoryPoint, PlayerStats, Standing } from "./types";
import type { MatchResult } from "@/types";

function mapStanding(uid: string, data: Record<string, unknown>): Standing {
  return {
    uid,
    rank: nullableNumber(data.rank) ?? 0,
    elo: nullableNumber(data.elo) ?? 0,
    w: nullableNumber(data.w) ?? 0,
    d: nullableNumber(data.d) ?? 0,
    l: nullableNumber(data.l) ?? 0,
    gf: nullableNumber(data.gf) ?? 0,
    ga: nullableNumber(data.ga) ?? 0,
    form: Array.isArray(data.form) ? (data.form as MatchResult[]) : [],
    move: nullableNumber(data.move) ?? 0,
  };
}

export async function getStandings(seasonId: string): Promise<Standing[]> {
  const snap = await getDocs(collection(db, "seasons", seasonId, "standings"));
  return snap.docs.map((doc) => mapStanding(doc.id, doc.data())).sort((a, b) => a.rank - b.rank);
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

// Mirrors functions/src/elo.ts — the server is the source of truth for ratings.
const ELO_K = 32;
const ELO_SCALE = 400;
const TEAM_ELO_PER_OVERALL = 12;

/**
 * Approximate the ELO delta for a result, for live UI preview only. This uses a plain
 * win/draw/loss score; the committed rating comes from the server's stats-aware
 * performanceScore (goals + shots-on-target + possession), so the preview can differ slightly.
 * Team overalls handicap the expectation exactly like the server: only when both are known.
 */
export function previewElo(
  myElo: number,
  opponentElo: number,
  myGoals: number,
  opponentGoals: number,
  myTeamOverall?: number | null,
  opponentTeamOverall?: number | null,
) {
  let myEff = myElo;
  let opponentEff = opponentElo;
  if (myTeamOverall != null && opponentTeamOverall != null) {
    myEff += TEAM_ELO_PER_OVERALL * myTeamOverall;
    opponentEff += TEAM_ELO_PER_OVERALL * opponentTeamOverall;
  }
  const expected = 1 / (1 + Math.pow(10, (opponentEff - myEff) / ELO_SCALE));
  const score = myGoals > opponentGoals ? 1 : myGoals < opponentGoals ? 0 : 0.5;
  return Math.round(ELO_K * (score - expected));
}
