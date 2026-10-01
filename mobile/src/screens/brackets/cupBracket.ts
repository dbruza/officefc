/**
 * Cup bracket shape, recovered client-side from the stored rounds. The state doc only
 * keeps ties per round; which earlier tie feeds which side (including byes that skip a
 * round) follows from the draw rules in functions/src/cupRules.ts, mirrored here so the
 * bracket can draw connectors and name empty sides ("Winner of QF 2").
 */
import type { CupBracket } from "@/lib/league";

export type CupSource = { kind: "draw" } | { kind: "tie"; round: number; tie: number };

export interface CupShape {
  /** Players in the opening draw. */
  entrants: number;
  /** sources[round][tie] = [side A source, side B source]. */
  sources: Array<Array<[CupSource, CupSource]>>;
}

/**
 * Participant slots per round satisfy: the final holds 2, and each earlier round holds its
 * own ties' slots plus the next round's (n_r = ties_r + n_{r+1}; the excess is the bye).
 * Slot s of round r+1 takes the winner of tie s of round r, except the trailing bye slot,
 * which inherits whatever filled round r's last slot — exactly placeWinner's carry.
 */
export function cupShape(rounds: CupBracket): CupShape {
  const total = rounds.length;
  if (total === 0) return { entrants: 0, sources: [] };
  const ties = rounds.map((round) => round.length);
  const slots: number[] = new Array(total).fill(0);
  slots[total - 1] = 2;
  for (let r = total - 2; r >= 0; r--) slots[r] = ties[r] + slots[r + 1];

  const draw: CupSource = { kind: "draw" };
  const slotSource: CupSource[][] = [Array.from({ length: slots[0] }, () => draw)];
  for (let r = 0; r < total - 1; r++) {
    const carried = slotSource[r][slots[r] - 1] ?? draw;
    slotSource.push(
      Array.from({ length: slots[r + 1] }, (_, s) =>
        s < ties[r] ? { kind: "tie" as const, round: r, tie: s } : carried,
      ),
    );
  }

  return {
    entrants: slots[0],
    sources: rounds.map((round, r) =>
      round.map((_, t): [CupSource, CupSource] => [
        slotSource[r][t * 2] ?? draw,
        slotSource[r][t * 2 + 1] ?? draw,
      ]),
    ),
  };
}

/** Rounds are named by distance from the final: an 8-entrant cup's first round is the
 *  quarter finals, a 16-entrant cup's is "Round 1". */
export function cupRoundLabel(index: number, total: number): string {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi Finals";
  if (fromEnd === 2) return "Quarter Finals";
  return index === 0 ? "Opening Round" : `Round ${index + 1}`;
}

/** Segmented-sized round name. */
export function cupRoundShort(index: number, total: number): string {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semis";
  if (fromEnd === 2) return "Quarters";
  return `R${index + 1}`;
}

/** One tie's name: "Final", "Semi 2", "QF 3", "R1 · Tie 4". */
export function cupTieLabel(round: number, tie: number, rounds: CupBracket): string {
  const total = rounds.length;
  const fromEnd = total - 1 - round;
  const single = (rounds[round]?.length ?? 0) <= 1;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return single ? "Semi Final" : `Semi ${tie + 1}`;
  if (fromEnd === 2) return single ? "Quarter Final" : `QF ${tie + 1}`;
  return `R${round + 1} · Tie ${tie + 1}`;
}
