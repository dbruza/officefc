/**
 * Rating preview for results that are still awaiting confirmation, so the opponent sees
 * what confirming will do to them ("1532 → 1520") before they tap Confirm.
 *
 * Uses the same `previewElo` the log-match screen shows the submitter, fed from the
 * season's current standings, the catalogue's team overalls and — for photo-assisted
 * results — the extracted xG/possession, so both sides see the same number. Finals ties
 * never move ELO (the server commits a delta of 0), so they're flagged instead.
 */
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { nullableNumber } from "./firestoreMap";
import { previewElo } from "./eloMath";
import { getSeason } from "./seasons";
import { getStandings } from "./standings";
import { getTeams } from "./teams";
import type { PendingMatch } from "./types";

export type PendingImpactInput = Pick<
  PendingMatch,
  "id" | "seasonId" | "aId" | "bId" | "aTeamId" | "bTeamId" | "aGoals" | "bGoals"
>;

export interface PendingImpact {
  matchId: string;
  source: "manual" | "ai_assisted" | "finals";
  /** Finals ties decide the bracket only — no ELO moves. */
  finals: boolean;
  aEloBefore: number;
  aDelta: number;
  bEloBefore: number;
  bDelta: number;
}

interface RawSide {
  xg: number | null;
  possession: number | null;
}

function rawSide(data: Record<string, unknown>, side: "a" | "b"): RawSide {
  const nested = data[`${side}Stats`];
  const stats = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : {};
  return {
    xg: nullableNumber(stats.xg ?? data[`${side}Xg`]),
    possession: nullableNumber(stats.possession ?? data[`${side}Possession`]),
  };
}

/** Previews keyed by match id. A match whose reads fail is simply left out. */
export async function getPendingImpacts(
  matches: PendingImpactInput[],
): Promise<Map<string, PendingImpact>> {
  const out = new Map<string, PendingImpact>();
  if (matches.length === 0) return out;

  const seasonIds = [...new Set(matches.map((m) => m.seasonId))];
  const [teams, seasons, standings, docs] = await Promise.all([
    getTeams().catch(() => []),
    Promise.all(seasonIds.map((id) => getSeason(id).catch(() => null))),
    Promise.all(seasonIds.map((id) => getStandings(id).catch(() => []))),
    Promise.all(matches.map((m) => getDoc(doc(db, "matches", m.id)).catch(() => null))),
  ]);
  const overallById = new Map(teams.map((team) => [team.id, team.overall]));

  matches.forEach((match, index) => {
    const snap = docs[index];
    if (!snap?.exists()) return;
    const data = snap.data() as Record<string, unknown>;
    const seasonIndex = seasonIds.indexOf(match.seasonId);
    const table = standings[seasonIndex] ?? [];
    const premierId = seasons[seasonIndex]?.reigningPremierId ?? null;
    const row = (uid: string) => table.find((s) => s.uid === uid);
    const aRow = row(match.aId);
    const bRow = row(match.bId);
    const aElo = aRow?.elo ?? 1500;
    const bElo = bRow?.elo ?? 1500;
    const finals = data.finals === true;
    const source = finals ? "finals" : data.source === "ai_assisted" ? "ai_assisted" : "manual";
    const a = rawSide(data, "a");
    const b = rawSide(data, "b");
    const aOverall = overallById.get(match.aTeamId);
    const bOverall = overallById.get(match.bTeamId);

    out.set(match.id, {
      matchId: match.id,
      source,
      finals,
      aEloBefore: aElo,
      bEloBefore: bElo,
      aDelta: finals
        ? 0
        : previewElo(
            aElo,
            bElo,
            match.aGoals,
            match.bGoals,
            aOverall,
            bOverall,
            aRow ? aRow.w + aRow.d + aRow.l : 0,
            premierId,
            match.aId,
            match.bId,
            {
              myXg: a.xg,
              opponentXg: b.xg,
              myPossession: a.possession,
              opponentPossession: b.possession,
            },
          ),
      bDelta: finals
        ? 0
        : previewElo(
            bElo,
            aElo,
            match.bGoals,
            match.aGoals,
            bOverall,
            aOverall,
            bRow ? bRow.w + bRow.d + bRow.l : 0,
            premierId,
            match.bId,
            match.aId,
            {
              myXg: b.xg,
              opponentXg: a.xg,
              myPossession: b.possession,
              opponentPossession: a.possession,
            },
          ),
    });
  });
  return out;
}
