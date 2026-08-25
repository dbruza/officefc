/**
 * Pure knockout-cup bracket logic: seeded draw, tie progression, completion. No Firestore
 * dependency — the IO layer in cup.ts feeds it data and persists the result.
 *
 * Draw: Fisher-Yates under a seeded mulberry32 PRNG, so the numeric seed stored on the
 * state doc reproduces the exact bracket later (auditable without trusting mutable docs).
 *
 * Bye policy (v1, deterministic): participants are taken in shuffled order; each round
 * pairs them consecutively, and a round holding an odd number of participants lets the
 * LAST one (latest-drawn) skip straight to the next round instead of pairing against a
 * ghost. Byes therefore always fall to the tail of the draw, and no tie is ever built with
 * a permanently empty side — every unfilled slot has exactly one producing tie upstream.
 */

export interface CupTie {
  /** Null while the qualifier from the previous round is still undecided. */
  aId: string | null;
  bId: string | null;
  /** Set once the tie is decided (by a confirmed match or an admin force-advance). */
  winnerId: string | null;
}

/** rounds[0] holds the opening ties; each later round consumes the previous round's winners. */
export type CupBracket = CupTie[][];

/** Tiny deterministic PRNG (mulberry32): plenty for shuffling a league roster. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(ids: string[], rand: () => number): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Build the full bracket skeleton for a seeded draw. Throws with fewer than 2 players. */
export function drawBracket(memberIds: string[], seed: number): CupBracket {
  if (memberIds.length < 2) {
    throw new Error("A cup needs at least 2 players.");
  }
  const rounds: CupBracket = [];
  let parts: Array<string | null> = shuffled(memberIds, mulberry32(seed));
  while (parts.length > 1) {
    const round: CupTie[] = [];
    const next: Array<string | null> = [];
    for (let i = 0; i < parts.length; i += 2) {
      if (i + 1 < parts.length) {
        round.push({ aId: parts[i], bId: parts[i + 1], winnerId: null });
        next.push(null);
      } else {
        // Odd participant out: takes the bye (see the bye-policy note in the header).
        next.push(parts[i]);
      }
    }
    rounds.push(round);
    parts = next;
  }
  return rounds;
}

/** First (earliest-round) unresolved tie whose pair is exactly these two players, or null. */
function findOpenTie(
  bracket: CupBracket,
  aId: string,
  bId: string,
): { roundIndex: number; tieIndex: number } | null {
  for (let roundIndex = 0; roundIndex < bracket.length; roundIndex++) {
    const round = bracket[roundIndex];
    for (let tieIndex = 0; tieIndex < round.length; tieIndex++) {
      const tie = round[tieIndex];
      if (tie.winnerId !== null) continue;
      const paired = (tie.aId === aId && tie.bId === bId) || (tie.aId === bId && tie.bId === aId);
      if (paired) return { roundIndex, tieIndex };
    }
  }
  return null;
}

/**
 * Place a winner into their participant slot of the following round. Slots pair
 * consecutively into ties; a trailing odd slot is a bye, whose holder skips that whole
 * round (e.g. 6 entrants → three opening ties, but only ONE semi — the third tie's
 * winner waits in the final). Carries forward until the slot lands in a real tie.
 */
function placeWinner(
  bracket: CupBracket,
  roundIndex: number,
  slot: number,
  winnerId: string,
): void {
  let r = roundIndex + 1;
  let s = slot;
  while (r < bracket.length) {
    const tieCount = bracket[r].length;
    if (s < tieCount * 2) {
      const target = bracket[r][Math.floor(s / 2)];
      if (!target) throw new Error("Corrupt bracket: the next round is missing a receiving tie.");
      if (s % 2 === 0) target.aId = winnerId;
      else target.bId = winnerId;
      return;
    }
    // Bye slot: the holder trails at index tieCount of the round after next's list.
    s = tieCount;
    r += 1;
  }
}

/**
 * Set a winner on one tie and drop them into the next round. Immutably: the input bracket
 * is never touched. Tie i of a round feeds participant slot i of the following round —
 * the inverse of how drawBracket lays rounds out (see placeWinner for byes).
 */
function resolveAt(
  bracket: CupBracket,
  roundIndex: number,
  tieIndex: number,
  winnerId: string,
): CupBracket {
  const copied = bracket.map((round) => round.map((tie) => ({ ...tie })));
  copied[roundIndex][tieIndex].winnerId = winnerId;
  placeWinner(copied, roundIndex, tieIndex, winnerId);
  return copied;
}

/**
 * Record a decided tie found by its pair (either side order) and propagate the winner.
 * Throws when the winner is not in the tie or no open tie exists for the pair — the latter
 * includes the race where a concurrent result already advanced that tie.
 */
export function advance(
  bracket: CupBracket,
  aId: string,
  bId: string,
  winnerId: string,
): CupBracket {
  if (winnerId !== aId && winnerId !== bId) {
    throw new Error(`${winnerId} is not part of this tie.`);
  }
  const spot = findOpenTie(bracket, aId, bId);
  if (!spot) throw new Error("No open tie between these two players.");
  return resolveAt(bracket, spot.roundIndex, spot.tieIndex, winnerId);
}

/**
 * Admin override: decide a specific stuck tie by coordinates (absence, voided-source
 * repair). Same validation and propagation as advance, addressed by position instead of
 * by pair. Throws on out-of-range coordinates, an already-decided tie, or an outsider.
 */
export function forceAdvanceAt(
  bracket: CupBracket,
  roundIndex: number,
  tieIndex: number,
  winnerId: string,
): CupBracket {
  const tie = bracket[roundIndex]?.[tieIndex];
  if (!tie) throw new Error("No tie exists at that position.");
  if (tie.winnerId !== null) throw new Error("That tie is already decided.");
  if (winnerId !== tie.aId && winnerId !== tie.bId) {
    throw new Error("Winner is not part of this tie.");
  }
  return resolveAt(bracket, roundIndex, tieIndex, winnerId);
}

/** True once the final tie is decided — the cup has a champion. */
export function isComplete(bracket: CupBracket): boolean {
  const final = bracket[bracket.length - 1];
  return final?.length === 1 && final[0].winnerId !== null;
}

/** The champion, or null while the final is undecided. */
export function cupChampion(bracket: CupBracket): string | null {
  const final = bracket[bracket.length - 1];
  return final?.length === 1 ? final[0].winnerId : null;
}
