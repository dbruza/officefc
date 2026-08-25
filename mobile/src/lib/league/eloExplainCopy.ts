// ---------------------------------------------------------------------------
// Plain-English ELO explanations — turns a confirmed match's eloExplain numbers
// into a single paragraph a player can actually read. Pure and deterministic
// (no Firestore, no React) so it stays unit-testable; the match detail screen
// renders the paragraph above the numbers table.
//
// Every number it quotes comes straight off the match doc (deltas, ratings,
// eloExplain), so the prose can never disagree with the committed math.
// ---------------------------------------------------------------------------

import { ELO_K, PROVISIONAL_GAMES, TEAM_ELO_PER_OVERALL } from "./eloMath";
import type { LeagueMatch } from "./types";
import { fmtXg } from "@/lib/format";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** "a team 1 overall point stronger" / "a team 3 overall points weaker". */
function teamPhrase(overallPts: number): string {
  const n = Math.abs(overallPts);
  return `a team ${n} overall point${n === 1 ? "" : "s"} ${overallPts > 0 ? "stronger" : "weaker"}`;
}

/** The pre-match sentence: who was expected to win, and which factors drove it.
 *  Told from whichever side the ratings leaned toward, so the drivers (rating
 *  gap, team handicap, premier bonus) attach to the right player. */
function expectationSentence(
  nameA: string,
  nameB: string,
  aElo: number,
  bElo: number,
  aExpected: number,
  aTeamAdj: number,
  aPremierAdj: number,
): string {
  // Whose story are we telling? Below 45% for A the interesting character is B.
  const aIsSubject = aExpected >= 0.45;
  const selfName = aIsSubject ? nameA : nameB;
  const oppName = aIsSubject ? nameB : nameA;
  const selfElo = aIsSubject ? aElo : bElo;
  const oppElo = aIsSubject ? bElo : aElo;
  const expected = aIsSubject ? aExpected : 1 - aExpected;
  // teamAdj/premierAdj flip sign with the viewpoint; dividing the team adj back
  // out by TEAM_ELO_PER_OVERALL recovers the FIFA overall-point gap the players
  // actually picked.
  const teamAdj = aIsSubject ? aTeamAdj : -aTeamAdj;
  const premierAdj = aIsSubject ? aPremierAdj : -aPremierAdj;

  const drivers: string[] = [];
  if (Math.abs(selfElo - oppElo) >= 5) drivers.push(`rated ${selfElo} to ${oppName}'s ${oppElo}`);
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
    return `Going in, ${selfName} was the strong favourite at ${pct(expected)}${driverList}.`;
  if (expected >= 0.55)
    return `Going in, ${selfName} was the favourite at ${pct(expected)}${driverList}.`;
  if (expected >= 0.45)
    return `Going in, the ratings leaned ${selfName}'s way at ${pct(expected)}${driverList}.`;
  if (expected >= 0.3)
    return `Going in, ${selfName} was the underdog at ${pct(expected)}${driverList}.`;
  return `Going in, ${selfName} was a big underdog at ${pct(expected)}${driverList}.`;
}

/** How the scoreline translated into a performance share, told once from the
 *  winning side (or split evenly for a draw). */
function performanceSentence(
  aGoals: number,
  bGoals: number,
  perfA: number,
  perfB: number,
  nameA: string,
  nameB: string,
): string {
  const score = `${aGoals}–${bGoals}`;
  if (aGoals > bGoals) {
    const p = pct(perfA);
    if (aGoals - bGoals === 1) {
      return `${nameA}'s narrow ${score} win only scores ${p} on performance — a one-goal margin counts for less than the scoreline suggests.`;
    }
    return `The win gives ${nameA} ${p} of the performance.`;
  }
  if (aGoals < bGoals) {
    const p = pct(perfB);
    if (bGoals - aGoals === 1) {
      return `${nameB}'s narrow ${bGoals}–${aGoals} win only scores ${p} on performance — a one-goal margin counts for less than the scoreline suggests.`;
    }
    return `The win gives ${nameB} ${p} of the performance.`;
  }
  return `The draw splits the performance ${pct(perfA)}/${pct(perfB)}.`;
}

/** What the recorded chances (expected goals, possession) added to the story.
 *  Returns null when no stats were recorded, or they point in conflicting
 *  directions and there is no single story to tell. Numbers are quoted A–B to
 *  match the stats table underneath. */
function statsSentence(match: LeagueMatch, nameA: string, nameB: string): string | null {
  const xgA = match.aStats?.xg ?? null;
  const xgB = match.bStats?.xg ?? null;
  const poss = match.aStats?.possession ?? null;
  const xgKnown = xgA != null && xgB != null;
  if (!xgKnown && poss == null) return null;

  const bits: string[] = [];
  if (xgKnown) bits.push(`${fmtXg(xgA!)}–${fmtXg(xgB!)} xG`);
  if (poss != null) bits.push(`${poss}% possession`);
  const desc = `(${bits.join(", ")})`;

  const xgEdge = xgKnown && xgA !== xgB ? Math.sign(xgA! - xgB!) : null;
  const possEdge = poss != null && poss !== 50 ? Math.sign(poss - 50) : null;
  const edges = [xgEdge, possEdge].filter((e): e is number => e !== null);
  if (edges.length === 0) return null;
  const edge = edges[0];
  if (edges.some((e) => e !== edge)) return null;

  const winner = edge > 0 ? nameA : nameB;
  const aWon = match.aGoals > match.bGoals;
  const drew = match.aGoals === match.bGoals;
  if (drew) return `${winner} shaded the chances ${desc}.`;
  const winnerIsEdgeSide = edge > 0 === aWon;
  return winnerIsEdgeSide
    ? `The chances backed the result ${desc}.`
    : `The chances told a different story ${desc}.`;
}

/** The closing sentence: what both deltas were, and the plainest reason why.
 *  Told from whichever side moved against type — an upset, or a favourite
 *  dropping points — because that's the interesting half of the story. */
function outcomeSentence(
  nameA: string,
  nameB: string,
  aDelta: number,
  bDelta: number,
  aGoals: number,
  bGoals: number,
  aExpected: number,
  k: number,
): string[] {
  const sentences: string[] = [];
  const aWon = aGoals > bGoals;
  const drew = aGoals === bGoals;
  const moved = Math.abs(aDelta) > 0 || Math.abs(bDelta) > 0;

  if (!moved) {
    sentences.push(
      drew
        ? "Dead level with expectations — ELO unchanged."
        : `Both results landed almost exactly on expectation (${pct(aExpected)}), so the moves rounded to 0.`,
    );
  } else if (drew) {
    const up = aDelta > 0 ? nameA : nameB;
    const p = aDelta > 0 ? pct(aExpected) : pct(1 - aExpected);
    sentences.push(
      `The draw came in above ${up}'s ${p} expectation — ${signed(Math.max(aDelta, bDelta))} apiece.`,
    );
  } else {
    // Winner's side of the ledger.
    const wDelta = aWon ? aDelta : bDelta;
    const lDelta = aWon ? bDelta : aDelta;
    const wName = aWon ? nameA : nameB;
    const lName = aWon ? nameB : nameA;
    const wExp = aWon ? aExpected : 1 - aExpected;

    if (wDelta < 0) {
      // Favourite won on the pitch but still lost rating — the counter-intuitive case.
      sentences.push(
        `The ratings expected this so strongly (${pct(wExp)}) that even the win scored below expectation — ${wName} ${signed(wDelta)}, ${lName} ${signed(lDelta)}.`,
      );
    } else if (wExp < 0.45) {
      sentences.push(
        `Beating a ${pct(wExp)} expectation is a proper upset — ${wName} ${signed(wDelta)}, ${lName} ${signed(lDelta)}.`,
      );
    } else {
      sentences.push(`${wName} takes ${signed(wDelta)}, ${lName} ${signed(lDelta)}.`);
    }
  }

  if (k > ELO_K) {
    sentences.push(
      `Moves are bigger while a rating settles — the provisional K-factor applies for a player's first ${PROVISIONAL_GAMES} games of a season.`,
    );
  }
  return sentences;
}

/**
 * Plain-English explanation of a confirmed match's ELO outcome as one
 * paragraph. Returns null when the match carries no explain breakdown, deltas,
 * or pre-match ratings (unconfirmed matches, finals, matches recalc'd before
 * the explain data existed) — callers should fall back to numbers-only
 * rendering.
 */
export function explainMatchEloParagraph(
  match: LeagueMatch,
  nameA: string,
  nameB: string,
): string | null {
  const ex = match.eloExplain;
  if (!ex) return null;
  if (match.aDelta === null || match.bDelta === null) return null;
  if (match.aEloBefore === null || match.bEloBefore === null) return null;

  const sentences: string[] = [
    expectationSentence(
      nameA,
      nameB,
      match.aEloBefore,
      match.bEloBefore,
      ex.aExpected,
      ex.aTeamAdj,
      ex.aPremierAdj,
    ),
  ];
  sentences.push(performanceSentence(match.aGoals, match.bGoals, ex.perfA, ex.perfB, nameA, nameB));
  const stats = statsSentence(match, nameA, nameB);
  if (stats) sentences.push(stats);
  sentences.push(
    ...outcomeSentence(
      nameA,
      nameB,
      match.aDelta,
      match.bDelta,
      match.aGoals,
      match.bGoals,
      ex.aExpected,
      Math.max(ex.aK, ex.bK),
    ),
  );
  return sentences.join(" ");
}
