/**
 * Pure rivalry maths behind the head-to-head screen's stats block and the player
 * profile's "Rivals" card. Inputs mirror the Firestore `h2h` read model written by
 * functions/src/stats.ts — finals matches are already excluded upstream — so screens
 * hand over the loaded documents directly and this module stays free of Firebase.
 */
import type { HeadToHead, H2HMeeting } from "../league/types";

/** Meetings an opponent needs before qualifying as nemesis/victim. Same threshold the
 *  server-side nemesis uses in functions/src/stats.ts. */
export const RIVAL_MIN_GAMES = 3;

export interface RivalryBiggestWin {
  matchId: string;
  date: Date | null;
  winnerId: string;
  loserId: string;
  winnerGoals: number;
  loserGoals: number;
  margin: number;
}

export interface RivalryStats {
  /** Confirmed meetings in the pairing (authoritative win/draw totals, not the capped slice). */
  games: number;
  totalGoals: number;
  /** Heaviest defeat dealt by EITHER side; null until someone wins a meeting. Drawn from the
   *  meetings slice the read model keeps (last 20), so older blowouts are out of scope. */
  biggestWin: RivalryBiggestWin | null;
  /** Combined goals divided by meetings; null with no meetings. */
  avgGoalsPerGame: number | null;
  /** Meetings where each side kept the opposition scoreless — a 0-0 counts for both. */
  aCleanSheets: number;
  bCleanSheets: number;
  /** Net rating points won/lost across the pairing, summed per side from the per-meeting
   *  deltas the read model stores. Meetings that predate per-match ELO storage contribute 0. */
  aEloSwing: number;
  bEloSwing: number;
}

/** Structural subset satisfied by the HeadToHead read-model document. */
export interface RivalryPairInput {
  aId: string;
  bId: string;
  aWins: number;
  bWins: number;
  draws: number;
  aGoals: number;
  bGoals: number;
  meetings: ReadonlyArray<
    Pick<H2HMeeting, "matchId" | "date" | "aGoals" | "bGoals" | "aDelta" | "bDelta">
  >;
}

/** Aggregates one pairing: biggest margin either way, goals pace, clean sheets, ELO swing. */
export function computeRivalryStats(pair: RivalryPairInput): RivalryStats {
  const games = pair.aWins + pair.bWins + pair.draws;
  const totalGoals = pair.aGoals + pair.bGoals;

  let biggestWin: RivalryBiggestWin | null = null;
  let aCleanSheets = 0;
  let bCleanSheets = 0;
  let aEloSwing = 0;
  let bEloSwing = 0;

  for (const meeting of pair.meetings) {
    if (meeting.bGoals === 0) aCleanSheets += 1;
    if (meeting.aGoals === 0) bCleanSheets += 1;
    aEloSwing += meeting.aDelta;
    bEloSwing += meeting.bDelta;

    const margin = Math.abs(meeting.aGoals - meeting.bGoals);
    // Equal margins keep the first meeting supplied — determinism over drama.
    if (margin > 0 && (!biggestWin || margin > biggestWin.margin)) {
      const aWon = meeting.aGoals > meeting.bGoals;
      biggestWin = {
        matchId: meeting.matchId,
        date: meeting.date,
        winnerId: aWon ? pair.aId : pair.bId,
        loserId: aWon ? pair.bId : pair.aId,
        winnerGoals: aWon ? meeting.aGoals : meeting.bGoals,
        loserGoals: aWon ? meeting.bGoals : meeting.aGoals,
        margin,
      };
    }
  }

  return {
    games,
    totalGoals,
    biggestWin,
    avgGoalsPerGame: games ? totalGoals / games : null,
    aCleanSheets,
    bCleanSheets,
    aEloSwing,
    bEloSwing,
  };
}

export interface RivalRecord {
  opponentId: string;
  wins: number;
  draws: number;
  losses: number;
  games: number;
  /** Points share (win = 1, draw = ½) as a whole percent — the same weighting the
   *  server-side nemesis applies, so a draw-heavy opponent never outranks one who
   *  actually beats you. */
  sharePercent: number;
}

export interface NemesisVictim {
  /** Worst points share against this player (min games), or null under the threshold. */
  nemesis: RivalRecord | null;
  /** Best points share against this player (min games), or null under the threshold. */
  victim: RivalRecord | null;
}

interface ScoredRecord extends RivalRecord {
  share: number;
}

/** Ranks one player's pair records. Ties break by sample size, then opponent id, mirroring
 *  the candidate chain in functions/src/stats.ts so client and server agree. */
function rankRecords(records: ScoredRecord[], direction: 1 | -1): RivalRecord | null {
  const sorted = [...records].sort(
    (a, b) =>
      direction * (a.share - b.share) ||
      b.games - a.games ||
      a.opponentId.localeCompare(b.opponentId),
  );
  const best = sorted[0];
  if (!best) return null;
  const { share, ...rest } = best;
  return rest;
}

/** Picks this player's nemesis (worst record) and victim (best record) across all pairings. */
export function computeNemesisVictim(
  uid: string,
  pairs: HeadToHead[],
  minGames: number = RIVAL_MIN_GAMES,
): NemesisVictim {
  const records: ScoredRecord[] = pairs
    .filter((pair) => pair.aId === uid || pair.bId === uid)
    .map((pair) => {
      const asA = pair.aId === uid;
      const wins = asA ? pair.aWins : pair.bWins;
      const losses = asA ? pair.bWins : pair.aWins;
      const games = wins + pair.draws + losses;
      const share = games ? (wins + pair.draws * 0.5) / games : 0;
      return {
        opponentId: asA ? pair.bId : pair.aId,
        wins,
        draws: pair.draws,
        losses,
        games,
        share,
        sharePercent: Math.round(share * 100),
      };
    })
    .filter((record) => record.games >= minGames);

  return {
    nemesis: rankRecords(records, 1),
    victim: rankRecords(records, -1),
  };
}
