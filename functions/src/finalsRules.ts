/**
 * Pure finals-bracket logic: construction from seeds, tie progression, and the no-draw
 * guard. No Firestore dependency — the IO layer in finals.ts feeds it data, deals teams
 * for newly opened ties, and persists the result.
 *
 * Format (top-6, AFL/NRL-style, fixed pairings, single life):
 *   Elimination 1: 3rd v 6th          → winner meets 2nd in Semi 2
 *   Elimination 2: 4th v 5th          → winner meets 1st in Semi 1
 *   Semi 1: 1st v winner E2, Semi 2: 2nd v winner E1
 *   Grand Final: winner S1 v winner S2
 * Degrades gracefully: 4–5 ranked players → straight semis (1v4, 2v3); 2–3 → grand final
 * only (1v2). Fewer than 2 ranked players cannot start finals.
 */

export type FinalsSlotKey = "e1" | "e2" | "s1" | "s2" | "gf";
export type FinalsRound = "elimination" | "semi" | "final";
export type BracketStructure = "top6" | "top4" | "top2";
export type FinalsDecidedBy = "regulation" | "extra_time" | "penalties" | "walkover";
export const FINALS_DECIDED_BY: FinalsDecidedBy[] = [
  "regulation",
  "extra_time",
  "penalties",
  "walkover",
];

export interface FinalsSeed {
  uid: string;
  rank: number;
  elo: number;
}

export interface FinalsSlot {
  key: FinalsSlotKey;
  round: FinalsRound;
  label: string;
  /** Fixed seed numbers for slots seeded directly from the table; null when fed by a slot. */
  homeSeed: number | null;
  awaySeed: number | null;
  /** Slot whose winner fills each side; null when seeded directly. */
  homeFrom: FinalsSlotKey | null;
  awayFrom: FinalsSlotKey | null;
  homeId: string | null;
  awayId: string | null;
  /** Equal-OVR dealt teams, assigned by the IO layer when the slot opens. */
  homeTeamId: string | null;
  homeTeamName: string | null;
  homeTeamOverall: number | null;
  awayTeamId: string | null;
  awayTeamName: string | null;
  awayTeamOverall: number | null;
  status: "pending" | "open" | "decided";
  matchId: string | null;
  winnerId: string | null;
  decidedBy: FinalsDecidedBy | null;
}

export interface FinalsBracket {
  structure: BracketStructure;
  seeds: FinalsSeed[];
  /** Top of the table when finals were locked — the Premier, decided at that moment. */
  premierId: string;
  slots: Partial<Record<FinalsSlotKey, FinalsSlot>>;
}

function emptySlot(
  key: FinalsSlotKey,
  round: FinalsRound,
  label: string,
  parts: Partial<FinalsSlot>,
): FinalsSlot {
  return {
    key,
    round,
    label,
    homeSeed: null,
    awaySeed: null,
    homeFrom: null,
    awayFrom: null,
    homeId: null,
    awayId: null,
    homeTeamId: null,
    homeTeamName: null,
    homeTeamOverall: null,
    awayTeamId: null,
    awayTeamName: null,
    awayTeamOverall: null,
    status: "pending",
    matchId: null,
    winnerId: null,
    decidedBy: null,
    ...parts,
  };
}

/** Build the bracket for the best available structure given the ranked seeds (best first). */
export function buildBracket(seeds: FinalsSeed[]): FinalsBracket {
  if (seeds.length < 2) {
    throw new Error("Finals need at least 2 ranked players.");
  }
  const premierId = seeds[0].uid;
  const at = (seedNo: number) => seeds[seedNo - 1].uid;

  if (seeds.length >= 6) {
    const top = seeds.slice(0, 6);
    return {
      structure: "top6",
      seeds: top,
      premierId,
      slots: {
        e1: emptySlot("e1", "elimination", "Elimination Final 1", {
          homeSeed: 3,
          awaySeed: 6,
          homeId: at(3),
          awayId: at(6),
          status: "open",
        }),
        e2: emptySlot("e2", "elimination", "Elimination Final 2", {
          homeSeed: 4,
          awaySeed: 5,
          homeId: at(4),
          awayId: at(5),
          status: "open",
        }),
        s1: emptySlot("s1", "semi", "Semi Final 1", {
          homeSeed: 1,
          homeId: at(1),
          awayFrom: "e2",
        }),
        s2: emptySlot("s2", "semi", "Semi Final 2", {
          homeSeed: 2,
          homeId: at(2),
          awayFrom: "e1",
        }),
        gf: emptySlot("gf", "final", "Grand Final", { homeFrom: "s1", awayFrom: "s2" }),
      },
    };
  }

  if (seeds.length >= 4) {
    const top = seeds.slice(0, 4);
    return {
      structure: "top4",
      seeds: top,
      premierId,
      slots: {
        s1: emptySlot("s1", "semi", "Semi Final 1", {
          homeSeed: 1,
          awaySeed: 4,
          homeId: at(1),
          awayId: at(4),
          status: "open",
        }),
        s2: emptySlot("s2", "semi", "Semi Final 2", {
          homeSeed: 2,
          awaySeed: 3,
          homeId: at(2),
          awayId: at(3),
          status: "open",
        }),
        gf: emptySlot("gf", "final", "Grand Final", { homeFrom: "s1", awayFrom: "s2" }),
      },
    };
  }

  const top = seeds.slice(0, 2);
  return {
    structure: "top2",
    seeds: top,
    premierId,
    slots: {
      gf: emptySlot("gf", "final", "Grand Final", {
        homeSeed: 1,
        awaySeed: 2,
        homeId: at(1),
        awayId: at(2),
        status: "open",
      }),
    },
  };
}

export interface AdvanceResult {
  bracket: FinalsBracket;
  /** Slots that just became playable and need teams dealt by the caller. */
  opened: FinalsSlotKey[];
}

/**
 * Record a decided tie and propagate the winner. Throws on: unknown slot, slot not open,
 * or a winner who isn't in the tie. A fed slot opens once both participants are known.
 */
export function advanceBracket(
  bracket: FinalsBracket,
  slotKey: FinalsSlotKey,
  winnerId: string,
  matchId: string | null,
  decidedBy: FinalsDecidedBy,
): AdvanceResult {
  const source = bracket.slots[slotKey];
  if (!source) throw new Error(`No slot ${slotKey} in this bracket.`);
  if (source.status !== "open") throw new Error(`${source.label} is not open.`);
  if (winnerId !== source.homeId && winnerId !== source.awayId) {
    throw new Error(`${winnerId} is not part of ${source.label}.`);
  }

  const slots: Partial<Record<FinalsSlotKey, FinalsSlot>> = {};
  for (const [key, slot] of Object.entries(bracket.slots) as [FinalsSlotKey, FinalsSlot][]) {
    slots[key] = { ...slot };
  }
  slots[slotKey] = { ...source, status: "decided", winnerId, matchId, decidedBy };

  const opened: FinalsSlotKey[] = [];
  for (const slot of Object.values(slots) as FinalsSlot[]) {
    if (slot.status !== "pending") continue;
    if (slot.homeFrom === slotKey) slot.homeId = winnerId;
    if (slot.awayFrom === slotKey) slot.awayId = winnerId;
    if (slot.homeId && slot.awayId) {
      slot.status = "open";
      opened.push(slot.key);
    }
  }

  return { bracket: { ...bracket, slots }, opened };
}

/** The Grand Final's loser, or null while it is undecided. */
export function bracketRunnerUpId(bracket: FinalsBracket): string | null {
  const gf = bracket.slots.gf;
  if (!gf || gf.status !== "decided" || !gf.winnerId) return null;
  return gf.winnerId === gf.homeId ? gf.awayId : gf.homeId;
}

/** True once the Grand Final is decided — the season can be finalized. */
export function bracketComplete(bracket: FinalsBracket): boolean {
  return bracket.slots.gf?.status === "decided";
}
