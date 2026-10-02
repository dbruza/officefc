/**
 * Team meta-analytics over a season's confirmed matches — the league-level view the
 * per-player read models never answer: which teams everyone picks, whether raw team
 * strength still buys results, and whether the auto-matchup engine is flattening it.
 *
 * Pure module: callers pass already-fetched matches plus the team catalogue; nothing
 * here touches Firestore. Finals ties are excluded from EVERY aggregation (they decide
 * the bracket on deliberately equal teams and never move ELO — mirroring the server's
 * own filters in functions/src/recalc.ts).
 */
import type { Team } from "./types";

/**
 * The slice of a confirmed match document the meta-aggregations need. `source` is the
 * RAW stored value ("fixture" | "manual" | "ai_assisted" | "finals") — not the client
 * mapper's collapsed pair, which erases fixture provenance and would make the fairness
 * card impossible.
 */
export interface MetaMatch {
  id: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  source: string | null;
  finals: boolean;
  date: Date | null;
}

/** Finals ties decide the bracket only; they never feed team meta-analytics. */
export function isRegularMatch(match: MetaMatch): boolean {
  return match.finals !== true;
}

/** `String()`-coerced Firestore blanks from older writers — same guard as teamRecord. */
function present(value: string): boolean {
  return !!value && value !== "undefined" && value !== "null";
}

interface SideRef {
  key: string;
  name: string;
  overall: number | null;
}

/** Resolve one side's team identity: catalogue id when present, else the recorded name.
 *  Mirrors computeTeamRecords so legacy docs without team ids still aggregate under a
 *  stable key, and the live catalogue supplies the canonical name + OVR. */
function sideOf(teamId: string, teamName: string, teamsById?: Map<string, Team>): SideRef {
  const id = present(teamId) ? teamId : "";
  const name = present(teamName) ? teamName : "";
  const catalogue = id ? teamsById?.get(id) : undefined;
  return {
    key: id || (name ? `name:${name.toLowerCase()}` : "unknown"),
    name: catalogue?.name || name || "Unknown team",
    overall: catalogue?.overall ?? null,
  };
}

/** Whole-percent rate, matching every other win rate in the app. */
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// --- Most-picked teams ---------------------------------------------------------------

export interface TeamUsage {
  /** Catalogue team id when the match carried one, else a name-derived key. */
  teamKey: string;
  name: string;
  overall: number | null;
  /** Times the team took the pitch (each side of each match counts once). */
  picks: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
}

interface UsageTally {
  name: string;
  overall: number | null;
  wins: number;
  draws: number;
  losses: number;
}

/**
 * Usage count + win rate per team across confirmed regular-season matches, counting
 * each side of every game. Sorted most-picked first; ties break on win rate, then name.
 */
export function mostPickedTeams(matches: MetaMatch[], teamsById?: Map<string, Team>): TeamUsage[] {
  const tallies = new Map<string, UsageTally>();

  for (const match of matches) {
    if (!isRegularMatch(match)) continue;
    const sides: Array<[SideRef, boolean]> = [
      [sideOf(match.aTeamId, match.aTeam, teamsById), match.aGoals > match.bGoals],
      [sideOf(match.bTeamId, match.bTeam, teamsById), match.bGoals > match.aGoals],
    ];
    for (const [side, won] of sides) {
      let tally = tallies.get(side.key);
      if (!tally) {
        tally = { name: side.name, overall: side.overall, wins: 0, draws: 0, losses: 0 };
        tallies.set(side.key, tally);
      }
      if (match.aGoals === match.bGoals) tally.draws += 1;
      else if (won) tally.wins += 1;
      else tally.losses += 1;
    }
  }

  return [...tallies.entries()]
    .map(([teamKey, tally]) => ({
      teamKey,
      name: tally.name,
      overall: tally.overall,
      picks: tally.wins + tally.draws + tally.losses,
      wins: tally.wins,
      draws: tally.draws,
      losses: tally.losses,
      winRate: pct(tally.wins, tally.wins + tally.draws + tally.losses),
    }))
    .sort(
      (a, b) =>
        b.picks - a.picks ||
        b.winRate - a.winRate ||
        a.wins + a.draws + a.losses - (b.wins + b.draws + b.losses) ||
        a.name.localeCompare(b.name),
    );
}

// --- Win rate by team-strength band --------------------------------------------------

export interface OvrBandDef {
  key: "sub74" | "b74to78" | "b79to83" | "b84plus";
  /** Display label; the ranges partition all finite OVRs (upper bounds exclusive). */
  label: string;
  /** Inclusive lower bound; null = unbounded below. */
  min: number | null;
  /** Exclusive upper bound; null = unbounded above. */
  max: number | null;
}

export const OVR_BANDS: readonly OvrBandDef[] = [
  { key: "sub74", label: "<74", min: null, max: 74 },
  { key: "b74to78", label: "74–78", min: 74, max: 79 },
  { key: "b79to83", label: "79–83", min: 79, max: 84 },
  { key: "b84plus", label: "84+", min: 84, max: null },
];

/** The band an OVR falls into, or null when the rating is unknown (custom teams). */
export function bandForOverall(overall: number | null): OvrBandDef | null {
  if (overall === null || !Number.isFinite(overall)) return null;
  return (
    OVR_BANDS.find(
      (band) =>
        (band.min === null || overall >= band.min) && (band.max === null || overall < band.max),
    ) ?? null
  );
}

export interface OvrBandStats {
  key: OvrBandDef["key"];
  label: string;
  picks: number;
  wins: number;
  winRate: number;
}

/**
 * Win rate per OVR band. Every pick is an observation credited to its side's band, so a
 * draw adds one game to both bands and a cross-band game lands a win in the winner's
 * band and a loss in the loser's. If the ELO-balanced engine works, band win rates
 * should hover near each other rather than climbing with strength. Bands with no data
 * are still returned (zero-filled) so the UI renders a stable grid.
 */
export function winRateByBand(matches: MetaMatch[], teamsById?: Map<string, Team>): OvrBandStats[] {
  const tallies = new Map<OvrBandDef["key"], { label: string; picks: number; wins: number }>(
    OVR_BANDS.map((band) => [band.key, { label: band.label, picks: 0, wins: 0 }]),
  );

  for (const match of matches) {
    if (!isRegularMatch(match)) continue;
    const sides: Array<[SideRef, boolean]> = [
      [sideOf(match.aTeamId, match.aTeam, teamsById), match.aGoals > match.bGoals],
      [sideOf(match.bTeamId, match.bTeam, teamsById), match.bGoals > match.aGoals],
    ];
    for (const [side, won] of sides) {
      const band = bandForOverall(side.overall);
      if (!band) continue;
      const tally = tallies.get(band.key);
      if (!tally) continue;
      tally.picks += 1;
      if (won) tally.wins += 1;
    }
  }

  return OVR_BANDS.map((band) => {
    const tally = tallies.get(band.key)!;
    return {
      key: band.key,
      label: tally.label,
      picks: tally.picks,
      wins: tally.wins,
      winRate: pct(tally.wins, tally.picks),
    };
  });
}

// --- Fixture-engine fairness ---------------------------------------------------------

export interface FairnessStats {
  /** Games where both sides' OVR is known — the sample every rate below draws from. */
  ratedGames: number;
  /** Decisive games with a strict favourite (non-zero gap) — win/upset denominators. */
  decisiveRated: number;
  higherOvrWins: number;
  higherOvrWinRate: number;
  upsets: number;
  upsetRate: number;
  draws: number;
  /** Mean |OVR gap| over rated games, one decimal (zero-gap games dilute it honestly). */
  avgOvrGap: number;
}

export interface FairnessBySource {
  fixture: FairnessStats;
  manual: FairnessStats;
}

function emptyFairness(): FairnessStats {
  return {
    ratedGames: 0,
    decisiveRated: 0,
    higherOvrWins: 0,
    higherOvrWinRate: 0,
    upsets: 0,
    upsetRate: 0,
    draws: 0,
    avgOvrGap: 0,
  };
}

function fairnessFor(
  matches: MetaMatch[],
  source: string,
  teamsById?: Map<string, Team>,
  options?: { includeAiAssisted?: boolean },
): FairnessStats {
  const stats = emptyFairness();
  let gapSum = 0;

  for (const match of matches) {
    if (!isRegularMatch(match)) continue;
    const inBucket =
      match.source === source ||
      (options?.includeAiAssisted === true && match.source === "ai_assisted");
    if (!inBucket) continue;
    const a = sideOf(match.aTeamId, match.aTeam, teamsById);
    const b = sideOf(match.bTeamId, match.bTeam, teamsById);
    if (a.overall === null || b.overall === null) continue;

    stats.ratedGames += 1;
    const gap = Math.abs(a.overall - b.overall);
    gapSum += gap;
    if (match.aGoals === match.bGoals) {
      stats.draws += 1;
      continue;
    }
    // Without a strict favourite there is no "higher-OVR side", so equal-OVR games
    // (e.g. both managers picking the same team) stay out of the win/upset rates.
    if (gap === 0) continue;
    stats.decisiveRated += 1;
    const aWon = match.aGoals > match.bGoals;
    const higherIsA = a.overall > b.overall;
    if (aWon === higherIsA) stats.higherOvrWins += 1;
    else stats.upsets += 1;
  }

  stats.higherOvrWinRate = pct(stats.higherOvrWins, stats.decisiveRated);
  stats.upsetRate = pct(stats.upsets, stats.decisiveRated);
  stats.avgOvrGap = stats.ratedGames ? Math.round((gapSum / stats.ratedGames) * 10) / 10 : 0;
  return stats;
}

/**
 * Fairness of dealt matchups vs hand-picked ones. Fixtures pair a stronger team with a
 * weaker player (and vice versa) so OVR advantage should NOT translate into wins there —
 * a high fixture higher-OVR win rate means the balancer is failing. Hand-picked games
 * (manual logs AND photo-logged ai_assisted matches — both are player-chosen teams) are
 * the natural control: there, the stronger team usually reflects a deliberate advantage.
 */
export function fairnessBySource(
  matches: MetaMatch[],
  teamsById?: Map<string, Team>,
): FairnessBySource {
  return {
    fixture: fairnessFor(matches, "fixture", teamsById),
    manual: fairnessFor(matches, "manual", teamsById, { includeAiAssisted: true }),
  };
}

// --- Biggest results -----------------------------------------------------------------

export interface BigResult {
  matchId: string;
  margin: number;
  aId: string;
  bId: string;
  aTeamName: string;
  bTeamName: string;
  aGoals: number;
  bGoals: number;
  date: Date | null;
}

/** Largest winning margins of the season, biggest first (ties: higher-scoring game,
 *  then match id for determinism). Draws have no margin and never appear. */
export function biggestResults(matches: MetaMatch[], limit = 5): BigResult[] {
  return matches
    .filter((match) => isRegularMatch(match) && match.aGoals !== match.bGoals)
    .map((match) => ({
      matchId: match.id,
      margin: Math.abs(match.aGoals - match.bGoals),
      aId: match.aId,
      bId: match.bId,
      aTeamName: match.aTeam || "Unknown team",
      bTeamName: match.bTeam || "Unknown team",
      aGoals: match.aGoals,
      bGoals: match.bGoals,
      date: match.date,
    }))
    .sort(
      (a, b) =>
        b.margin - a.margin ||
        b.aGoals + b.bGoals - (a.aGoals + a.bGoals) ||
        a.matchId.localeCompare(b.matchId),
    )
    .slice(0, Math.max(0, limit));
}
