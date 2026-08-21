// ---------------------------------------------------------------------------
// Plain-English ELO explanations — turns a confirmed match's eloExplain numbers
// into sentences a player can actually read, one block per player. Pure and
// deterministic (no Firestore, no React) so it stays unit-testable; the match
// detail screen renders the sentences above the numbers table.
//
// Every number it quotes comes straight off the match doc (deltas, ratings,
// eloExplain), so the prose can never disagree with the committed math.
// ---------------------------------------------------------------------------

import { ELO_K, PROVISIONAL_GAMES, TEAM_ELO_PER_OVERALL } from "./eloMath";
import type { LeagueMatch } from "./types";

/** One player's explanation: display name plus sentences in reading order. */
export interface SideEloExplanation {
  name: string;
  sentences: string[];
}

export interface MatchEloExplanation {
  a: SideEloExplanation;
  b: SideEloExplanation;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** "a team 1 overall point stronger" / "a team 3 overall points weaker". */
function teamPhrase(overallPts: number): string {
  const n = Math.abs(overallPts);
  return `a team ${n} overall point${n === 1 ? "" : "s"} ${overallPts > 0 ? "stronger" : "weaker"}`;
}

/** The pre-match sentence: who was expected to win, and which factors drove it. */
function expectationSentence(
  myName: string,
  oppName: string,
  myElo: number,
  oppElo: number,
  expected: number,
  teamAdj: number,
  premierAdj: number,
): string {
  const drivers: string[] = [];
  if (Math.abs(myElo - oppElo) >= 5) drivers.push(`rated ${myElo} to ${oppName}'s ${oppElo}`);
  // teamAdj = TEAM_ELO_PER_OVERALL × (my overall − opponent overall), so dividing
  // back out recovers the FIFA overall-point gap the players actually picked.
  const overallPts = Math.round(teamAdj / TEAM_ELO_PER_OVERALL);
  if (overallPts !== 0)
    drivers.push(`with ${teamPhrase(overallPts)} (about ${Math.abs(teamAdj)} ELO)`);
  if (premierAdj > 0) drivers.push(`plus ${premierAdj} ELO as the reigning premier`);
  if (premierAdj < 0)
    drivers.push(`with ${oppName} rated ${-premierAdj} ELO higher as the reigning premier`);

  if (drivers.length === 0) {
    return "Going in, the ratings had this about 50–50 — nothing separated the two.";
  }
  const driverList = ` — ${drivers.join(", ")}`;
  if (expected >= 0.7)
    return `Going in, ${myName} was the strong favourite at ${pct(expected)}${driverList}.`;
  if (expected >= 0.55)
    return `Going in, ${myName} was the favourite at ${pct(expected)}${driverList}.`;
  if (expected >= 0.45)
    return `Going in, the ratings leaned ${myName}'s way at ${pct(expected)}${driverList}.`;
  if (expected >= 0.3)
    return `Going in, ${myName} was the underdog at ${pct(expected)}${driverList}.`;
  return `Going in, ${myName} was a big underdog at ${pct(expected)}${driverList}.`;
}

/** How the scoreline translated into a performance share. */
function performanceSentence(myGoals: number, oppGoals: number, perf: number): string {
  const score = `${myGoals}–${oppGoals}`;
  const p = pct(perf);
  if (myGoals > oppGoals) {
    if (myGoals - oppGoals === 1) {
      return `A narrow ${score} win only scores ${p} on performance — a one-goal margin counts for less than the scoreline suggests.`;
    }
    return `The ${score} win scores ${p} on performance.`;
  }
  if (myGoals < oppGoals) {
    if (oppGoals - myGoals <= 2) {
      return `The ${score} loss still scores ${p} on performance — losing well softens the fall.`;
    }
    return `The ${score} loss scores ${p} on performance.`;
  }
  return `The ${score} draw scores ${p} on performance.`;
}

/** What the recorded chances (shots on target, possession) added to the story.
 *  Returns null when no stats were recorded, or they point in conflicting
 *  directions and there is no single story to tell. */
function statsSentence(match: LeagueMatch, side: "a" | "b", oppName: string): string | null {
  const mine = side === "a";
  const myStats = (mine ? match.aStats : match.bStats) ?? null;
  const oppStats = (mine ? match.bStats : match.aStats) ?? null;
  const sotMine = myStats?.shotsOnTarget ?? null;
  const sotOpp = oppStats?.shotsOnTarget ?? null;
  const poss = myStats?.possession ?? null;
  const sotKnown = sotMine != null && sotOpp != null;
  if (!sotKnown && poss == null) return null;

  const bits: string[] = [];
  if (sotKnown) bits.push(`${sotMine}–${sotOpp} shots on target`);
  if (poss != null) bits.push(`${poss}% possession`);
  const desc = `(${bits.join(", ")})`;

  const sotEdge = sotKnown && sotMine !== sotOpp ? Math.sign(sotMine! - sotOpp!) : null;
  const possEdge = poss != null && poss !== 50 ? Math.sign(poss - 50) : null;
  const edges = [sotEdge, possEdge].filter((e): e is number => e !== null);
  if (edges.length === 0) return null;
  const edge = edges[0];
  if (edges.some((e) => e !== edge)) return null;

  const myGoals = mine ? match.aGoals : match.bGoals;
  const oppGoals = mine ? match.bGoals : match.aGoals;
  if (myGoals > oppGoals) {
    return edge > 0
      ? `The chances backed the result ${desc}.`
      : `They were second-best on the chances, though ${desc}.`;
  }
  if (myGoals < oppGoals) {
    return edge > 0
      ? `They created the better chances despite the score ${desc}.`
      : `The chances went the same way as the score ${desc}.`;
  }
  return edge > 0 ? `They shaded the chances ${desc}.` : `${oppName} shaded the chances ${desc}.`;
}

/** The outcome sentence: what the delta was, and the plainest reason why. */
function outcomeSentence(
  result: "W" | "D" | "L",
  delta: number,
  expected: number,
  oppName: string,
): string {
  const p = pct(expected);
  if (delta === 0) {
    if (result === "W") {
      return `That landed almost exactly on the ${p} expectation, so it rounded to 0 — nothing to gain from a win the ratings already saw coming.`;
    }
    if (result === "D") return "Dead level with expectations — ELO unchanged.";
    return `The result landed almost exactly on the ${p} expectation, so it rounded to 0.`;
  }
  if (result === "W") {
    if (delta > 0) {
      if (expected < 0.45)
        return `Beating a ${p} expectation is a proper upset — worth ${signed(delta)}.`;
      return `The win came in ahead of the ${p} expectation — worth ${signed(delta)}.`;
    }
    return `The ratings expected this so strongly (${p}) that even the win scored below expectation — ELO ${signed(delta)}.`;
  }
  if (result === "L") {
    if (delta > 0)
      return `Even the loss came in above the ${p} expectation — ELO ${signed(delta)}.`;
    if (expected >= 0.55) return `An upset in ${oppName}'s favour — ELO ${signed(delta)}.`;
    return `The loss landed close to expectations — ELO ${signed(delta)}.`;
  }
  return delta > 0
    ? `The draw came in above the ${p} expectation — ELO ${signed(delta)}.`
    : `The draw came in below the ${p} expectation — ELO ${signed(delta)}.`;
}

/** Provisional-K note, only for a player still inside their first games of the season. */
function provisionalSentence(k: number): string | null {
  if (k <= ELO_K) return null;
  return `Moves are bigger while a rating settles — the provisional K-factor (${k}) applies for a player's first ${PROVISIONAL_GAMES} games of a season.`;
}

function explainSide(
  match: LeagueMatch,
  side: "a" | "b",
  myName: string,
  oppName: string,
): SideEloExplanation {
  const ex = match.eloExplain!;
  const mine = side === "a";
  const myElo = (mine ? match.aEloBefore : match.bEloBefore)!;
  const oppElo = (mine ? match.bEloBefore : match.aEloBefore)!;
  const myGoals = mine ? match.aGoals : match.bGoals;
  const oppGoals = mine ? match.bGoals : match.aGoals;
  const expected = mine ? ex.aExpected : ex.bExpected;
  const perf = mine ? ex.perfA : ex.perfB;
  const teamAdj = mine ? ex.aTeamAdj : ex.bTeamAdj;
  const premierAdj = mine ? ex.aPremierAdj : ex.bPremierAdj;
  const k = mine ? ex.aK : ex.bK;
  const delta = (mine ? match.aDelta : match.bDelta)!;

  const result = myGoals > oppGoals ? "W" : myGoals < oppGoals ? "L" : "D";
  const sentences = [
    expectationSentence(myName, oppName, myElo, oppElo, expected, teamAdj, premierAdj),
    performanceSentence(myGoals, oppGoals, perf),
  ];
  const stats = statsSentence(match, side, oppName);
  if (stats) sentences.push(stats);
  sentences.push(outcomeSentence(result, delta, expected, oppName));
  const provisional = provisionalSentence(k);
  if (provisional) sentences.push(provisional);
  return { name: myName, sentences };
}

/**
 * Plain-English explanation of both players' ELO outcomes for a confirmed
 * match. Returns null when the match carries no explain breakdown, deltas, or
 * pre-match ratings (unconfirmed matches, finals, matches recalc'd before the
 * explain data existed) — callers should fall back to numbers-only rendering.
 */
export function explainMatchElo(
  match: LeagueMatch,
  nameA: string,
  nameB: string,
): MatchEloExplanation | null {
  if (!match.eloExplain) return null;
  if (match.aDelta === null || match.bDelta === null) return null;
  if (match.aEloBefore === null || match.bEloBefore === null) return null;
  return {
    a: explainSide(match, "a", nameA, nameB),
    b: explainSide(match, "b", nameB, nameA),
  };
}
