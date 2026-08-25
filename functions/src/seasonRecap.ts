/**
 * Pure season-recap derivation: the highlight-reel facts of a finalized season (golden boot,
 * biggest upset, game of the season, …) computed from data the finalize flow already holds in
 * memory. Deliberately free of Firestore imports so it stays unit-testable and is reusable by
 * a future backfill of pre-recap seasons.
 *
 * Section gates and deterministic definitions (same season => identical output, whatever the
 * input ordering):
 * - goldenBoot      Most goals scored; ties -> fewer games (more clinical), then lexical uid.
 * - bestDefense     Fewest goals conceded among players with >= ceil(1/2 x max games played);
 *                   ties -> fewer games (tighter record), then lexical uid.
 * - mostImproved    Biggest net Elo climb = final Elo - season-start Elo. calculateSeason
 *                   seeds EVERY player at BASE_ELO at the start of each season, so a published
 *                   standing's `elo` already IS the season-total climb. Ranked players only
 *                   (matching the published table). Ties -> lexical uid.
 * - longestWinStreak Most consecutive wins in date order (a draw or loss breaks it); ties ->
 *                   whoever reached the streak first, then lexical uid.
 * - biggestRivalry  Pair with the most head-to-head games (pair uids ordered lexically in the
 *                   output); ties -> lexical pair key.
 * - gameOfTheSeason Most combined goals; ties -> earliest match, then lexical match id.
 * - biggestUpset    Among wins where the victor finished STRICTLY BELOW the loser in the final
 *                   table (a player absent from the standings — provisional/unlisted — counts
 *                   as bottom-most), the biggest goal margin; ties -> earliest match, then
 *                   lexical match id. Absent when the table order never flipped: a runaway
 *                   champion simply leaves no upsets behind.
 *
 * A season with no matches produces an empty recap ({}), and any section whose defining fact
 * is missing is simply absent — the client renders around gaps.
 */
import { BASE_ELO } from "./elo";

/** Minimal match facts; the richer SeasonMatchInput from elo.ts satisfies this structurally. */
export interface RecapMatchInput {
  id: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
  dateMillis: number;
}

/** Minimal standing facts; the full Standing from elo.ts satisfies this structurally. */
export interface RecapStandingInput {
  uid: string;
  rank: number;
  elo: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

export interface RecapPotmInput {
  month: string;
  playerId: string;
  gain: number;
  games: number;
}

export interface DeriveRecapInput {
  standings: RecapStandingInput[];
  matches: RecapMatchInput[];
  /** Carried in the contract so callers can hand over the whole finalize picture unchanged;
   *  today's sections are all derivable from standings + matches, so these stay unread. */
  coreIds: {
    championId: string | null;
    runnerUpId: string | null;
    premierId: string | null;
  };
  potm: RecapPotmInput[];
  /** Explicit season-start ratings, overriding the BASE_ELO default. Only needed if the Elo
   *  model ever stops resetting ratings each season (see mostImproved above). */
  startEloByUid?: Record<string, number>;
}

export interface GoldenBootRecap {
  playerId: string;
  goals: number;
}

export interface BestDefenseRecap {
  playerId: string;
  conceded: number;
}

export interface MostImprovedRecap {
  playerId: string;
  eloGain: number;
}

export interface WinStreakRecap {
  playerId: string;
  streak: number;
}

export interface RivalryRecap {
  /** Lexically smaller uid of the pair, so the pair is unambiguous regardless of input order. */
  aId: string;
  bId: string;
  games: number;
}

export interface GameOfTheSeasonRecap {
  matchId: string;
  aId: string;
  bId: string;
  aGoals: number;
  bGoals: number;
}

export interface BiggestUpsetRecap {
  matchId: string;
  winnerId: string;
  loserId: string;
  winnerGoals: number;
  loserGoals: number;
}

/** Only the sections whose defining fact exists are keyed; absent sections are omitted so the
 *  Firestore write never stores null placeholders. */
export interface SeasonRecap {
  goldenBoot?: GoldenBootRecap;
  bestDefense?: BestDefenseRecap;
  mostImproved?: MostImprovedRecap;
  longestWinStreak?: WinStreakRecap;
  biggestRivalry?: RivalryRecap;
  gameOfTheSeason?: GameOfTheSeasonRecap;
  biggestUpset?: BiggestUpsetRecap;
}

interface PlayerTally {
  uid: string;
  games: number;
  gf: number;
  ga: number;
}

function tallyPlayers(matches: RecapMatchInput[]): PlayerTally[] {
  const tallies = new Map<string, PlayerTally>();
  const side = (uid: string): PlayerTally => {
    let entry = tallies.get(uid);
    if (!entry) {
      entry = { uid, games: 0, gf: 0, ga: 0 };
      tallies.set(uid, entry);
    }
    return entry;
  };
  for (const match of matches) {
    const a = side(match.aId);
    const b = side(match.bId);
    a.games += 1;
    a.gf += match.aGoals;
    a.ga += match.bGoals;
    b.games += 1;
    b.gf += match.bGoals;
    b.ga += match.aGoals;
  }
  return [...tallies.values()];
}

/** Date order first, match id as the millisecond-collision breaker — same rule calculateSeason
 *  uses, so streak/upset facts can't disagree with the official rating walk. */
function chronological(matches: RecapMatchInput[]): RecapMatchInput[] {
  return [...matches].sort((a, b) => a.dateMillis - b.dateMillis || a.id.localeCompare(b.id));
}

export function deriveRecap(input: DeriveRecapInput): SeasonRecap {
  const { standings, matches, startEloByUid } = input;
  if (matches.length === 0) return {};

  const recap: SeasonRecap = {};

  // --- Golden Boot: most goals, fewer games wins a tie, lexical uid as the last resort. ---
  const boot = tallyPlayers(matches).sort(
    (a, b) => b.gf - a.gf || a.games - b.games || a.uid.localeCompare(b.uid),
  )[0];
  if (boot) recap.goldenBoot = { playerId: boot.uid, goals: boot.gf };

  // --- Golden Glove: fewest conceded, but only among players with a real body of work —
  // otherwise a 1-game stand-in always beats a full-season keeper. ---
  const tallies = tallyPlayers(matches);
  const maxGames = Math.max(...tallies.map((tally) => tally.games));
  const gamesQualifier = Math.ceil(maxGames * 0.5);
  const eligible = tallies.filter((tally) => tally.games >= gamesQualifier);
  const glove = eligible.sort(
    (a, b) => a.ga - b.ga || a.games - b.games || a.uid.localeCompare(b.uid),
  )[0];
  if (glove) recap.bestDefense = { playerId: glove.uid, conceded: glove.ga };

  // --- Most Improved: final Elo minus season-start Elo (BASE_ELO unless overridden). ---
  const improved = [...standings]
    .map((standing) => ({
      uid: standing.uid,
      gain: standing.elo - (startEloByUid?.[standing.uid] ?? BASE_ELO),
    }))
    .sort((a, b) => b.gain - a.gain || a.uid.localeCompare(b.uid))[0];
  if (improved) recap.mostImproved = { playerId: improved.uid, eloGain: improved.gain };

  // --- Longest win streak over the chronological walk; only a win extends the run, and the
  // earliest achiever wins a tie (recorded the first time the peak is reached). ---
  interface StreakState {
    run: number;
    best: number;
    bestEndedAt: number;
  }
  const streaks = new Map<string, StreakState>();
  for (const match of chronological(matches)) {
    const decided = match.aGoals !== match.bGoals;
    const winnerId = decided ? (match.aGoals > match.bGoals ? match.aId : match.bId) : null;
    for (const uid of [match.aId, match.bId]) {
      const state = streaks.get(uid) ?? { run: 0, best: 0, bestEndedAt: 0 };
      state.run = uid === winnerId ? state.run + 1 : 0;
      // Strictly greater keeps bestEndedAt pinned to the FIRST time the peak was hit.
      if (state.run > state.best) {
        state.best = state.run;
        state.bestEndedAt = match.dateMillis;
      }
      streaks.set(uid, state);
    }
  }
  const streaker = [...streaks.entries()]
    .map(([uid, state]) => ({ uid, ...state }))
    .sort((a, b) => b.best - a.best || a.bestEndedAt - b.bestEndedAt || a.uid.localeCompare(b.uid))
    .find((state) => state.best > 0);
  if (streaker) recap.longestWinStreak = { playerId: streaker.uid, streak: streaker.best };

  // --- Biggest rivalry: unordered pair key so a-b and b-a count as the same meeting; the
  // stored pair order is lexical, so the key itself is the final tie-break. ---
  const rivalries = new Map<string, { aId: string; bId: string; games: number }>();
  for (const match of matches) {
    const [aId, bId] = [match.aId, match.bId].sort((x, y) => x.localeCompare(y));
    const key = `${aId}|${bId}`;
    const entry = rivalries.get(key) ?? { aId, bId, games: 0 };
    entry.games += 1;
    rivalries.set(key, entry);
  }
  const rivalry = [...rivalries.entries()]
    .sort((a, b) => b[1].games - a[1].games || a[0].localeCompare(b[0]))
    .map(([, entry]) => ({ ...entry }))[0];
  if (rivalry) recap.biggestRivalry = rivalry;

  // --- Game of the season: most combined goals, earliest wins a tie. ---
  const thriller = chronological(matches)
    .map((match) => ({ match, total: match.aGoals + match.bGoals }))
    .sort((a, b) => b.total - a.total)[0];
  if (thriller) {
    recap.gameOfTheSeason = {
      matchId: thriller.match.id,
      aId: thriller.match.aId,
      bId: thriller.match.bId,
      aGoals: thriller.match.aGoals,
      bGoals: thriller.match.bGoals,
    };
  }

  // --- Biggest upset: biggest margin by a winner who finished below the loser. Players not in
  // the standings (provisional/unlisted) sit at the very bottom, so a debutant shocking a
  // ranked regular counts — but two unlisted players (both Infinity) never qualify. ---
  const rankByUid = new Map(standings.map((standing) => [standing.uid, standing.rank]));
  const BOTTOM = Number.POSITIVE_INFINITY;
  const upset = chronological(matches)
    .filter((match) => match.aGoals !== match.bGoals)
    .map((match) => {
      const winnerWon = match.aGoals > match.bGoals;
      return {
        match,
        winnerId: winnerWon ? match.aId : match.bId,
        loserId: winnerWon ? match.bId : match.aId,
        winnerGoals: Math.max(match.aGoals, match.bGoals),
        loserGoals: Math.min(match.aGoals, match.bGoals),
        winnerRank: rankByUid.get(winnerWon ? match.aId : match.bId) ?? BOTTOM,
        loserRank: rankByUid.get(winnerWon ? match.bId : match.aId) ?? BOTTOM,
      };
    })
    .filter((candidate) => candidate.winnerRank > candidate.loserRank)
    .sort((a, b) => {
      const marginA = a.winnerGoals - a.loserGoals;
      const marginB = b.winnerGoals - b.loserGoals;
      return (
        marginB - marginA ||
        a.match.dateMillis - b.match.dateMillis ||
        a.match.id.localeCompare(b.match.id)
      );
    })[0];
  if (upset) {
    recap.biggestUpset = {
      matchId: upset.match.id,
      winnerId: upset.winnerId,
      loserId: upset.loserId,
      winnerGoals: upset.winnerGoals,
      loserGoals: upset.loserGoals,
    };
  }

  return recap;
}
