import { dataCache } from "../dataCache";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";
import { asDate, nullableNumber } from "./firestoreMap";
import type { EloHistoryPoint, PlayerStats, Standing } from "./types";
import type { MatchResult } from "@/types";

/**
 * Confirmed games a player needs before holding a ranked place. Mirrors
 * functions/src/elo.ts MIN_RANKED_GAMES — the server decides `ranked`; this copy only
 * drives UI copy ("3 games to qualify", "1 more game to rank").
 */
export const MIN_RANKED_GAMES = 3;

function mapStanding(uid: string, data: Record<string, unknown>): Standing {
  const rank = nullableNumber(data.rank) ?? 0;
  return {
    uid,
    rank,
    elo: nullableNumber(data.elo) ?? 0,
    w: nullableNumber(data.w) ?? 0,
    d: nullableNumber(data.d) ?? 0,
    l: nullableNumber(data.l) ?? 0,
    gf: nullableNumber(data.gf) ?? 0,
    ga: nullableNumber(data.ga) ?? 0,
    form: Array.isArray(data.form) ? (data.form as MatchResult[]) : [],
    move: nullableNumber(data.move) ?? 0,
    // Pre-migration docs have no `ranked` field but always carried a rank >= 1.
    ranked: typeof data.ranked === "boolean" ? data.ranked : rank >= 1,
  };
}

export async function getStandings(seasonId: string): Promise<Standing[]> {
  return dataCache.read(
    `standings:${seasonId}`,
    async () => {
      return timed("getStandings", async () => {
        const snap = await getDocs(collection(db, "seasons", seasonId, "standings"));
        return (
          snap.docs
            .map((doc) => mapStanding(doc.id, doc.data()))
            // Ranked players first (by rank), then provisional players (by ELO).
            .sort((a, b) => Number(b.ranked) - Number(a.ranked) || a.rank - b.rank || b.elo - a.elo)
        );
      });
    },
    5000,
  );
}

export async function getEloHistory(seasonId: string, uid: string): Promise<EloHistoryPoint[]> {
  return dataCache.read(
    `history:${seasonId}:${uid}`,
    async () => {
      const snap = await getDoc(doc(db, "seasons", seasonId, "eloHistory", uid));
      if (!snap.exists()) return [];
      const points = snap.get("points");
      if (!Array.isArray(points)) return [];
      return points.map((point) => ({
        matchId: typeof point.matchId === "string" ? point.matchId : null,
        date: asDate(point.date),
        rating: Number(point.rating),
      }));
    },
    10000,
  );
}

export async function getPlayerStats(uid: string): Promise<PlayerStats | null> {
  return dataCache.read(
    `playerStats:${uid}`,
    async () => {
      return timed("getPlayerStats", async () => {
        const snap = await getDoc(doc(db, "playerStats", uid));
        return snap.exists() ? (snap.data() as PlayerStats) : null;
      });
    },
    10000,
  );
}

// The ELO preview math lives in ./eloMath (a dependency-free port of the server's
// functions/src/elo.ts). Re-exported here so existing imports from the league barrel
// keep working, and so the preview formula has a single home guarded by a parity test.
export { previewElo } from "./eloMath";
export type { PreviewStats } from "./eloMath";
