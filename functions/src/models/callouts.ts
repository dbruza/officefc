/**
 * Season callouts — the fun layer of the Stats tab. Three sets of facts about the people
 * in a season, computed from its confirmed matches:
 *
 * - headlines    The season's stand-out moments (a hot streak, the upset of the season, a
 *                demolition…). Best candidate per kind, at most one per player and match.
 * - superlatives A yearbook: every player with CALLOUT_MIN_GAMES+ games gets exactly one
 *                title for whatever they stand out at most against the rest of the league;
 *                anyone short of that still appears as a new signing.
 * - feuds        The most-played, most one-sided and closest pairings.
 *
 * Output is FACTS ONLY (ids, numbers, ISO dates). Titles and wording live in the app
 * (mobile/src/lib/calloutCopy.ts) so copy can change without a summary version bump.
 *
 * Pure module (no Firestore), deterministic: the same season yields identical callouts
 * whatever order its matches arrive in. Finals ties are excluded, as everywhere else in
 * season stats. Every value is Firestore-safe — null, never undefined.
 */
import { sideOf } from "./teamMeta";
import type { MatchResult, Team } from "./types";

/** The slice of a confirmed match the callouts need; SummaryMatch satisfies it. */
export interface CalloutMatch {
  id: string;
  aId: string;
  bId: string;
  aTeamId: string;
  bTeamId: string;
  aTeam: string;
  bTeam: string;
  aGoals: number;
  bGoals: number;
  date: Date | null;
  finals?: boolean;
  aEloBefore: number | null;
  bEloBefore: number | null;
  aDelta: number | null;
  bDelta: number | null;
}

export type HeadlineKey = "heater" | "upset" | "thrashing" | "goalFest" | "swing" | "slump";

export interface Headline {
  key: HeadlineKey;
  /** Who the headline is about (the winner, for match headlines). */
  playerId: string;
  /** Their opponent, when the headline is about one match. */
  otherId: string | null;
  matchId: string | null;
  /** heater/slump: run length · upset: ELO gap · thrashing: margin · goalFest: total
   *  goals · swing: ELO gained. */
  value: number;
  /** Match headlines: the score from playerId's side. */
  gf: number | null;
  ga: number | null;
  /** ISO kickoff of the match, or of the player's latest game for runs. */
  date: string | null;
  /** How interesting the headline is; the list is sorted by it, biggest first. */
  weight: number;
}

export type SuperlativeKey =
  | "serialWinner"
  | "goalMachine"
  | "wall"
  | "giantKiller"
  | "chaos"
  | "glassCannon"
  | "fineMargins"
  | "drawMerchant"
  | "underdog"
  | "loyalist"
  | "clubHopper"
  | "lateBloomer"
  | "fastStarter"
  | "rollercoaster"
  | "hardToBeat"
  | "everPresent"
  | "nearlyMan"
  | "flatTrackBully"
  /** Eligible, but nothing stood out above the league average. */
  | "squadPlayer"
  /** Played, but fewer than CALLOUT_MIN_GAMES games. */
  | "newSigning";

export interface Superlative {
  key: SuperlativeKey;
  playerId: string;
  /** The title's number — units per key in the app's copy table. */
  value: number;
  /** Second number for two-sided titles (Glass Cannon: conceded per game); else null. */
  extra: number | null;
  /** The Loyalist's team; else null. */
  label: string | null;
  games: number;
}

export type FeudKey = "mostPlayed" | "oneSided" | "deadHeat";

export interface Feud {
  key: FeudKey;
  /** The side with the better record (lexically first uid when level). */
  playerId: string;
  otherId: string;
  games: number;
  /** Record and goals from playerId's side. */
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  lastMatchId: string;
}

export interface SeasonCallouts {
  headlines: Headline[];
  superlatives: Superlative[];
  feuds: Feud[];
}

/** Games before a player earns a yearbook title — the same bar as a ranked table place. */
export const CALLOUT_MIN_GAMES = 3;
/** Meetings before a pairing counts as a feud. */
export const FEUD_MIN_MEETINGS = 3;
export const HEADLINE_LIMIT = 6;

const HOT_STREAK = 3;
const COLD_RUN = 3;
/** A slump is a gentle roast: however long it runs, it never outranks good news. */
const SLUMP_MAX_WEIGHT = 40;
const UPSET_GAP = 50;
const THRASHING_MARGIN = 3;
const GOAL_FEST = 6;
const BIG_SWING = 20;
/** Headlines from the season's last week get a nudge up the order. */
const RECENT_MS = 7 * 86_400_000;
const RECENT_BOOST = 15;
/** Fewest games before the first-half/second-half form split means anything. */
const FORM_SPLIT_GAMES = 6;

/** Tie-break order when two headlines weigh the same. */
const HEADLINE_ORDER: readonly HeadlineKey[] = [
  "heater",
  "upset",
  "thrashing",
  "goalFest",
  "swing",
  "slump",
];

export function emptyCallouts(): SeasonCallouts {
  return { headlines: [], superlatives: [], feuds: [] };
}

export function seasonCallouts(
  matches: readonly CalloutMatch[],
  teams?: Map<string, Team>,
): SeasonCallouts {
  const ordered = chronological(matches);
  if (ordered.length === 0) return emptyCallouts();
  const players = tallyPlayers(ordered, teams);
  return {
    headlines: pickHeadlines(ordered, players),
    superlatives: assignSuperlatives(players),
    feuds: pickFeuds(ordered),
  };
}

// --- Per-player tallies ----------------------------------------------------------------

interface PlayerTally {
  games: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  oneGoalWins: number;
  oneGoalLosses: number;
  /** Games against a player rated higher (pre-match ELO), and wins over higher / lower. */
  higherRatedGames: number;
  higherRatedWins: number;
  lowerRatedWins: number;
  /** Wins with the lower-OVR team, both ratings known. */
  underdogWins: number;
  results: MatchResult[];
  teams: Map<string, { name: string; games: number }>;
  lastDate: Date | null;
}

function tallyPlayers(
  ordered: readonly CalloutMatch[],
  teams?: Map<string, Team>,
): Map<string, PlayerTally> {
  const tallies = new Map<string, PlayerTally>();
  const tally = (uid: string) => {
    let entry = tallies.get(uid);
    if (!entry) {
      entry = {
        games: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        oneGoalWins: 0,
        oneGoalLosses: 0,
        higherRatedGames: 0,
        higherRatedWins: 0,
        lowerRatedWins: 0,
        underdogWins: 0,
        results: [],
        teams: new Map(),
        lastDate: null,
      };
      tallies.set(uid, entry);
    }
    return entry;
  };

  for (const match of ordered) {
    const aTeam = sideOf(match.aTeamId, match.aTeam, teams);
    const bTeam = sideOf(match.bTeamId, match.bTeam, teams);
    const sides = [
      {
        uid: match.aId,
        gf: match.aGoals,
        ga: match.bGoals,
        elo: match.aEloBefore,
        oppElo: match.bEloBefore,
        team: aTeam,
        oppTeam: bTeam,
      },
      {
        uid: match.bId,
        gf: match.bGoals,
        ga: match.aGoals,
        elo: match.bEloBefore,
        oppElo: match.aEloBefore,
        team: bTeam,
        oppTeam: aTeam,
      },
    ];
    for (const side of sides) {
      const entry = tally(side.uid);
      entry.games += 1;
      entry.gf += side.gf;
      entry.ga += side.ga;
      entry.lastDate = match.date ?? entry.lastDate;
      const margin = side.gf - side.ga;
      // > 0: the opponent was rated higher going in; null: a rating was missing.
      const eloGap = side.elo !== null && side.oppElo !== null ? side.oppElo - side.elo : null;
      if (eloGap !== null && eloGap > 0) entry.higherRatedGames += 1;
      if (margin > 0) {
        entry.w += 1;
        entry.results.push("W");
        if (margin === 1) entry.oneGoalWins += 1;
        if (eloGap !== null && eloGap > 0) entry.higherRatedWins += 1;
        else if (eloGap !== null && eloGap < 0) entry.lowerRatedWins += 1;
        if (
          side.team.overall !== null &&
          side.oppTeam.overall !== null &&
          side.team.overall < side.oppTeam.overall
        )
          entry.underdogWins += 1;
      } else if (margin < 0) {
        entry.l += 1;
        entry.results.push("L");
        if (margin === -1) entry.oneGoalLosses += 1;
      } else {
        entry.d += 1;
        entry.results.push("D");
      }
      const used = entry.teams.get(side.team.key);
      if (used) used.games += 1;
      else entry.teams.set(side.team.key, { name: side.team.name, games: 1 });
    }
  }
  return tallies;
}

// --- Headlines -------------------------------------------------------------------------

function pickHeadlines(
  ordered: readonly CalloutMatch[],
  players: Map<string, PlayerTally>,
): Headline[] {
  const latest = Math.max(...ordered.map((match) => match.date?.getTime() ?? 0));
  const candidates: Headline[] = [];
  const add = (
    key: HeadlineKey,
    weight: number,
    fields: Omit<Headline, "key" | "weight" | "date"> & { date: Date | null },
  ) => {
    const time = fields.date?.getTime() ?? null;
    const recent = latest > 0 && time !== null && latest - time <= RECENT_MS;
    candidates.push({
      ...fields,
      key,
      date: fields.date?.toISOString() ?? null,
      weight: Math.round(weight + (recent ? RECENT_BOOST : 0)),
    });
  };

  for (const [uid, tally] of players) {
    const hot = trailing(tally.results, (r) => r === "W");
    const cold = trailing(tally.results, (r) => r !== "W");
    const run = { playerId: uid, otherId: null, matchId: null, gf: null, ga: null };
    if (hot >= HOT_STREAK)
      add("heater", 20 + 10 * hot, { ...run, value: hot, date: tally.lastDate });
    if (cold >= COLD_RUN)
      add("slump", Math.min(12 + 8 * cold, SLUMP_MAX_WEIGHT), {
        ...run,
        value: cold,
        date: tally.lastDate,
      });
  }

  for (const match of ordered) {
    const total = match.aGoals + match.bGoals;
    const margin = Math.abs(match.aGoals - match.bGoals);
    const aWon = match.aGoals > match.bGoals;
    const winner = {
      playerId: aWon ? match.aId : match.bId,
      otherId: aWon ? match.bId : match.aId,
      matchId: match.id,
      gf: Math.max(match.aGoals, match.bGoals),
      ga: Math.min(match.aGoals, match.bGoals),
      date: match.date,
    };
    if (margin > 0) {
      const winnerElo = aWon ? match.aEloBefore : match.bEloBefore;
      const loserElo = aWon ? match.bEloBefore : match.aEloBefore;
      if (winnerElo !== null && loserElo !== null && loserElo - winnerElo >= UPSET_GAP) {
        const gap = Math.round(loserElo - winnerElo);
        add("upset", gap / 2, { ...winner, value: gap });
      }
      if (margin >= THRASHING_MARGIN) add("thrashing", 15 * margin, { ...winner, value: margin });
    }
    if (total >= GOAL_FEST) {
      // A draw has no winner: lead with the lexically-first player for a stable headline.
      const lead =
        margin > 0
          ? winner
          : {
              ...winner,
              playerId: match.aId < match.bId ? match.aId : match.bId,
              otherId: match.aId < match.bId ? match.bId : match.aId,
            };
      add("goalFest", 8 * total, { ...lead, value: total });
    }
    for (const [uid, opp, delta, gf, ga] of [
      [match.aId, match.bId, match.aDelta, match.aGoals, match.bGoals],
      [match.bId, match.aId, match.bDelta, match.bGoals, match.aGoals],
    ] as const) {
      if (delta !== null && delta >= BIG_SWING) {
        add("swing", 1.5 * delta, {
          playerId: uid,
          otherId: opp,
          matchId: match.id,
          value: Math.round(delta),
          gf,
          ga,
          date: match.date,
        });
      }
    }
  }

  candidates.sort(
    (x, y) =>
      y.weight - x.weight ||
      HEADLINE_ORDER.indexOf(x.key) - HEADLINE_ORDER.indexOf(y.key) ||
      x.playerId.localeCompare(y.playerId) ||
      (x.matchId ?? "").localeCompare(y.matchId ?? ""),
  );
  const keys = new Set<HeadlineKey>();
  const people = new Set<string>();
  const matchIds = new Set<string>();
  const picked: Headline[] = [];
  for (const candidate of candidates) {
    if (picked.length >= HEADLINE_LIMIT) break;
    if (keys.has(candidate.key) || people.has(candidate.playerId)) continue;
    if (candidate.matchId !== null && matchIds.has(candidate.matchId)) continue;
    keys.add(candidate.key);
    people.add(candidate.playerId);
    if (candidate.matchId !== null) matchIds.add(candidate.matchId);
    picked.push(candidate);
  }
  return picked;
}

// --- Superlatives ----------------------------------------------------------------------

type Metric =
  | "winRate"
  | "gpg"
  | "cpg"
  | "chaos"
  | "drawRate"
  | "higherWins"
  | "lowerWins"
  | "oneGoalWins"
  | "oneGoalLosses"
  | "underdogWins"
  | "loyalty"
  | "teamCount"
  | "flips"
  | "unbeatenRun"
  | "games"
  | "formShift";

const METRICS: Record<Metric, (p: PlayerTally) => number | null> = {
  winRate: (p) => p.w / p.games,
  gpg: (p) => p.gf / p.games,
  cpg: (p) => p.ga / p.games,
  chaos: (p) => (p.gf + p.ga) / p.games,
  drawRate: (p) => p.d / p.games,
  higherWins: (p) => p.higherRatedWins,
  lowerWins: (p) => p.lowerRatedWins,
  oneGoalWins: (p) => p.oneGoalWins,
  oneGoalLosses: (p) => p.oneGoalLosses,
  underdogWins: (p) => p.underdogWins,
  loyalty: (p) => favouriteTeam(p).games / p.games,
  teamCount: (p) => p.teams.size,
  flips: (p) => (p.games > 1 ? resultFlips(p.results) / (p.games - 1) : null),
  unbeatenRun: (p) => longestRun(p.results, (r) => r !== "L"),
  games: (p) => p.games,
  formShift: (p) => formShift(p.results),
};

interface TitleDef {
  key: SuperlativeKey;
  /** How far the player stands out, from their per-metric z-scores; must be > 0. */
  strength: (z: (metric: Metric) => number | null) => number | null;
  /** Hard floor so a title never lands on a weak case, whatever the league average. */
  qualifies: (p: PlayerTally) => boolean;
  value: (p: PlayerTally) => number;
  extra?: (p: PlayerTally) => number;
  label?: (p: PlayerTally) => string;
  /** A gentle roast: scaled down so a player who also stands out at something
   *  flattering gets that instead. */
  roast?: true;
}

/** How much a roast title's strength is discounted against flattering ones. */
const ROAST_DISCOUNT = 0.75;

const neg = (z: number | null) => (z === null ? null : -z);

/** In tie-break order: when two titles stand out equally, the earlier one wins. */
const TITLES: readonly TitleDef[] = [
  {
    key: "serialWinner",
    strength: (z) => z("winRate"),
    qualifies: (p) => p.w / p.games >= 0.5,
    value: (p) => Math.round((p.w / p.games) * 100),
  },
  {
    key: "goalMachine",
    strength: (z) => z("gpg"),
    qualifies: (p) => p.gf / p.games >= 2,
    value: (p) => round1(p.gf / p.games),
  },
  {
    key: "wall",
    strength: (z) => neg(z("cpg")),
    qualifies: (p) => p.ga / p.games <= 1.5,
    value: (p) => round1(p.ga / p.games),
  },
  {
    key: "giantKiller",
    strength: (z) => z("higherWins"),
    qualifies: (p) => p.higherRatedWins >= 2,
    value: (p) => p.higherRatedWins,
  },
  {
    key: "chaos",
    strength: (z) => z("chaos"),
    qualifies: (p) => (p.gf + p.ga) / p.games >= 5,
    value: (p) => round1((p.gf + p.ga) / p.games),
  },
  {
    key: "glassCannon",
    roast: true,
    strength: (z) => {
      const scored = z("gpg");
      const conceded = z("cpg");
      return scored === null || conceded === null ? null : Math.min(scored, conceded);
    },
    qualifies: (p) => p.gf / p.games >= 1.5 && p.ga / p.games >= 1.5,
    value: (p) => round1(p.gf / p.games),
    extra: (p) => round1(p.ga / p.games),
  },
  {
    key: "fineMargins",
    strength: (z) => z("oneGoalWins"),
    qualifies: (p) => p.oneGoalWins >= 2,
    value: (p) => p.oneGoalWins,
  },
  {
    key: "drawMerchant",
    strength: (z) => z("drawRate"),
    qualifies: (p) => p.d >= 2,
    value: (p) => p.d,
  },
  {
    key: "underdog",
    strength: (z) => z("underdogWins"),
    qualifies: (p) => p.underdogWins >= 2,
    value: (p) => p.underdogWins,
  },
  {
    key: "loyalist",
    strength: (z) => z("loyalty"),
    qualifies: (p) => p.games >= 4 && favouriteTeam(p).games / p.games >= 0.6,
    value: (p) => Math.round((favouriteTeam(p).games / p.games) * 100),
    label: (p) => favouriteTeam(p).name,
  },
  {
    key: "clubHopper",
    strength: (z) => z("teamCount"),
    qualifies: (p) => p.teams.size >= 4 && p.teams.size >= p.games / 2,
    value: (p) => p.teams.size,
  },
  {
    key: "lateBloomer",
    strength: (z) => z("formShift"),
    qualifies: (p) => (formShift(p.results) ?? 0) >= 0.25,
    value: (p) => Math.round((formShift(p.results) ?? 0) * 100),
  },
  {
    key: "fastStarter",
    roast: true,
    strength: (z) => neg(z("formShift")),
    qualifies: (p) => (formShift(p.results) ?? 0) <= -0.25,
    value: (p) => Math.round(-(formShift(p.results) ?? 0) * 100),
  },
  {
    key: "hardToBeat",
    strength: (z) => z("unbeatenRun"),
    qualifies: (p) => longestRun(p.results, (r) => r !== "L") >= 4,
    value: (p) => longestRun(p.results, (r) => r !== "L"),
  },
  {
    key: "rollercoaster",
    strength: (z) => z("flips"),
    qualifies: (p) => resultFlips(p.results) >= 3,
    value: (p) => resultFlips(p.results),
  },
  {
    key: "everPresent",
    strength: (z) => z("games"),
    qualifies: (p) => p.games >= 5,
    value: (p) => p.games,
  },
  {
    key: "nearlyMan",
    roast: true,
    strength: (z) => z("oneGoalLosses"),
    qualifies: (p) => p.oneGoalLosses >= 2,
    value: (p) => p.oneGoalLosses,
  },
  {
    key: "flatTrackBully",
    roast: true,
    strength: (z) => z("lowerWins"),
    // Everyone is rated below the leader, so "never beat a stronger player" only counts
    // once they've actually faced a few.
    qualifies: (p) => p.lowerRatedWins >= 3 && p.higherRatedGames >= 2 && p.higherRatedWins === 0,
    value: (p) => p.lowerRatedWins,
  },
];

/**
 * One title per eligible player. Each (player, title) pair scores the player's z-score on
 * the title's metric against the other eligible players; pairs are handed out greedily,
 * strongest first, so a title goes to whoever stands out most at it among players who
 * haven't already got a better one. Only above-average (z > 0) pairs that clear the
 * title's hard floor count, and roasts are discounted so they only land when nothing
 * flattering stands out as much. Anyone left over is a squad player.
 */
function assignSuperlatives(players: Map<string, PlayerTally>): Superlative[] {
  const uids = [...players.keys()].sort((x, y) => x.localeCompare(y));
  const eligible = uids.filter((uid) => players.get(uid)!.games >= CALLOUT_MIN_GAMES);

  const zScores = new Map<Metric, Map<string, number>>();
  for (const metric of Object.keys(METRICS) as Metric[]) {
    const values = eligible.flatMap((uid) => {
      const value = METRICS[metric](players.get(uid)!);
      return value === null ? [] : [[uid, value] as const];
    });
    const mean = values.reduce((sum, [, v]) => sum + v, 0) / (values.length || 1);
    const sd = Math.sqrt(
      values.reduce((sum, [, v]) => sum + (v - mean) ** 2, 0) / (values.length || 1),
    );
    zScores.set(metric, new Map(values.map(([uid, v]) => [uid, sd > 0 ? (v - mean) / sd : 0])));
  }

  const candidates: { uid: string; title: TitleDef; order: number; strength: number }[] = [];
  for (const uid of eligible) {
    const tally = players.get(uid)!;
    const z = (metric: Metric) => zScores.get(metric)?.get(uid) ?? null;
    TITLES.forEach((title, order) => {
      if (!title.qualifies(tally)) return;
      const raw = title.strength(z);
      if (raw === null || raw <= 0) return;
      const strength = title.roast ? raw * ROAST_DISCOUNT : raw;
      candidates.push({ uid, title, order, strength });
    });
  }
  candidates.sort(
    (x, y) => y.strength - x.strength || x.order - y.order || x.uid.localeCompare(y.uid),
  );

  const titled: Superlative[] = [];
  const taken = new Set<SuperlativeKey>();
  const done = new Set<string>();
  for (const { uid, title } of candidates) {
    if (taken.has(title.key) || done.has(uid)) continue;
    const tally = players.get(uid)!;
    taken.add(title.key);
    done.add(uid);
    titled.push({
      key: title.key,
      playerId: uid,
      value: title.value(tally),
      extra: title.extra?.(tally) ?? null,
      label: title.label?.(tally) ?? null,
      games: tally.games,
    });
  }

  const byGames = (x: string, y: string) =>
    players.get(y)!.games - players.get(x)!.games || x.localeCompare(y);
  const fallback = (key: SuperlativeKey) => (uid: string) => {
    const games = players.get(uid)!.games;
    return { key, playerId: uid, value: games, extra: null, label: null, games };
  };
  return [
    ...titled,
    ...eligible
      .filter((uid) => !done.has(uid))
      .sort(byGames)
      .map(fallback("squadPlayer")),
    ...uids
      .filter((uid) => players.get(uid)!.games < CALLOUT_MIN_GAMES)
      .sort(byGames)
      .map(fallback("newSigning")),
  ];
}

// --- Feuds -----------------------------------------------------------------------------

interface PairTally {
  key: string;
  lo: string;
  hi: string;
  games: number;
  loWins: number;
  hiWins: number;
  draws: number;
  loGoals: number;
  hiGoals: number;
  lastMatchId: string;
  lastTime: number;
}

function pickFeuds(ordered: readonly CalloutMatch[]): Feud[] {
  const pairs = new Map<string, PairTally>();
  for (const match of ordered) {
    if (match.aId === match.bId) continue;
    const [lo, hi] = match.aId < match.bId ? [match.aId, match.bId] : [match.bId, match.aId];
    const key = `${lo}|${hi}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = {
        key,
        lo,
        hi,
        games: 0,
        loWins: 0,
        hiWins: 0,
        draws: 0,
        loGoals: 0,
        hiGoals: 0,
        lastMatchId: match.id,
        lastTime: 0,
      };
      pairs.set(key, pair);
    }
    const loGoals = match.aId === lo ? match.aGoals : match.bGoals;
    const hiGoals = match.aId === lo ? match.bGoals : match.aGoals;
    pair.games += 1;
    pair.loGoals += loGoals;
    pair.hiGoals += hiGoals;
    if (loGoals > hiGoals) pair.loWins += 1;
    else if (hiGoals > loGoals) pair.hiWins += 1;
    else pair.draws += 1;
    // `ordered` is chronological, so the last one seen is the latest meeting.
    pair.lastMatchId = match.id;
    pair.lastTime = match.date?.getTime() ?? pair.lastTime;
  }

  const feuds = [...pairs.values()].filter((pair) => pair.games >= FEUD_MIN_MEETINGS);
  const used = new Set<string>();
  const out: Feud[] = [];
  const take = (key: FeudKey, pool: PairTally[], order: (x: PairTally, y: PairTally) => number) => {
    const pair = pool
      .filter((candidate) => !used.has(candidate.key))
      .sort((x, y) => order(x, y) || x.key.localeCompare(y.key))[0];
    if (!pair) return;
    used.add(pair.key);
    out.push(orientFeud(key, pair));
  };

  take("mostPlayed", feuds, (x, y) => y.games - x.games || y.lastTime - x.lastTime);
  take(
    "oneSided",
    feuds.filter((pair) => leaderShare(pair) >= 0.75),
    (x, y) => leaderShare(y) - leaderShare(x) || y.games - x.games,
  );
  take(
    "deadHeat",
    feuds.filter((pair) => Math.abs(pair.loWins - pair.hiWins) <= 1),
    (x, y) => y.games - x.games || y.draws - x.draws,
  );
  return out;
}

/** Points share (draw = half) of whichever side leads the pairing. */
function leaderShare(pair: PairTally): number {
  return (Math.max(pair.loWins, pair.hiWins) + pair.draws / 2) / pair.games;
}

function orientFeud(key: FeudKey, pair: PairTally): Feud {
  const loLeads = pair.loWins >= pair.hiWins;
  return {
    key,
    playerId: loLeads ? pair.lo : pair.hi,
    otherId: loLeads ? pair.hi : pair.lo,
    games: pair.games,
    w: loLeads ? pair.loWins : pair.hiWins,
    d: pair.draws,
    l: loLeads ? pair.hiWins : pair.loWins,
    gf: loLeads ? pair.loGoals : pair.hiGoals,
    ga: loLeads ? pair.hiGoals : pair.loGoals,
    lastMatchId: pair.lastMatchId,
  };
}

// --- Internals -------------------------------------------------------------------------

/** Regular-season matches, oldest first; undated games sort first, ties break on id, so
 *  the order never depends on how the caller fetched them. */
function chronological(matches: readonly CalloutMatch[]): CalloutMatch[] {
  return matches
    .filter((match) => match.finals !== true)
    .sort(
      (x, y) => (x.date?.getTime() ?? 0) - (y.date?.getTime() ?? 0) || x.id.localeCompare(y.id),
    );
}

/** Length of the run at the newest end of `results` that satisfies `test`. */
function trailing(results: readonly MatchResult[], test: (r: MatchResult) => boolean): number {
  let run = 0;
  for (let i = results.length - 1; i >= 0 && test(results[i]); i -= 1) run += 1;
  return run;
}

/** Longest run anywhere in `results` that satisfies `test`. */
function longestRun(results: readonly MatchResult[], test: (r: MatchResult) => boolean): number {
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = test(r) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Times consecutive decisive results switch between win and loss (draws in between
 *  don't reset it: W D L is still one flip). */
function resultFlips(results: readonly MatchResult[]): number {
  let flips = 0;
  let last: MatchResult | null = null;
  for (const r of results) {
    if (r === "D") continue;
    if (last !== null && r !== last) flips += 1;
    last = r;
  }
  return flips;
}

/** Second-half win rate minus first-half win rate (odd middle game skipped); null when
 *  there are too few games for halves to mean anything. */
function formShift(results: readonly MatchResult[]): number | null {
  if (results.length < FORM_SPLIT_GAMES) return null;
  const half = Math.floor(results.length / 2);
  const rate = (slice: readonly MatchResult[]) =>
    slice.filter((r) => r === "W").length / slice.length;
  return rate(results.slice(results.length - half)) - rate(results.slice(0, half));
}

/** Most-used team; ties break on name for a stable label. */
function favouriteTeam(p: PlayerTally): { name: string; games: number } {
  return [...p.teams.values()].sort((x, y) => y.games - x.games || x.name.localeCompare(y.name))[0];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
