import { mutate, invalidateData } from "../dataCache";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import type { FinalsBracket, FinalsDecidedBy, FinalsSlot, FinalsSlotKey } from "./types";

const SLOT_ORDER: FinalsSlotKey[] = ["e1", "e2", "s1", "s2", "gf"];

function mapSlot(key: FinalsSlotKey, raw: Record<string, unknown>): FinalsSlot {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    key,
    round: raw.round === "elimination" || raw.round === "semi" ? raw.round : "final",
    label: String(raw.label ?? key),
    homeSeed: num(raw.homeSeed),
    awaySeed: num(raw.awaySeed),
    homeFrom: str(raw.homeFrom) as FinalsSlotKey | null,
    awayFrom: str(raw.awayFrom) as FinalsSlotKey | null,
    homeId: str(raw.homeId),
    awayId: str(raw.awayId),
    homeTeamId: str(raw.homeTeamId),
    homeTeamName: str(raw.homeTeamName),
    homeTeamOverall: num(raw.homeTeamOverall),
    awayTeamId: str(raw.awayTeamId),
    awayTeamName: str(raw.awayTeamName),
    awayTeamOverall: num(raw.awayTeamOverall),
    status: raw.status === "open" || raw.status === "decided" ? raw.status : "pending",
    matchId: str(raw.matchId),
    winnerId: str(raw.winnerId),
    decidedBy: str(raw.decidedBy) as FinalsDecidedBy | null,
  };
}

/** The season's finals bracket, or null if finals haven't been started. */
export async function getBracket(seasonId: string): Promise<FinalsBracket | null> {
  const snap = await getDoc(doc(db, "seasons", seasonId, "finals", "bracket"));
  if (!snap.exists()) return null;
  const data = snap.data();
  const rawSlots = (data.slots ?? {}) as Record<string, Record<string, unknown>>;
  const slots: Partial<Record<FinalsSlotKey, FinalsSlot>> = {};
  for (const key of SLOT_ORDER) {
    if (rawSlots[key]) slots[key] = mapSlot(key, rawSlots[key]);
  }
  return {
    structure: data.structure === "top4" || data.structure === "top2" ? data.structure : "top6",
    seeds: Array.isArray(data.seeds)
      ? data.seeds.map((seed: Record<string, unknown>) => ({
          uid: String(seed.uid),
          rank: Number(seed.rank),
          elo: Number(seed.elo),
        }))
      : [],
    premierId: String(data.premierId ?? ""),
    slots,
  };
}

/** Bracket slots in display order. */
export function bracketSlots(bracket: FinalsBracket): FinalsSlot[] {
  return SLOT_ORDER.map((key) => bracket.slots[key]).filter(
    (slot): slot is FinalsSlot => slot != null,
  );
}

/** The open slot between these two players, if any — used to lock log-match into finals mode. */
export function openSlotForPair(
  bracket: FinalsBracket,
  uidA: string,
  uidB: string,
): FinalsSlot | null {
  for (const slot of bracketSlots(bracket)) {
    if (slot.status !== "open") continue;
    const pair = [slot.homeId, slot.awayId];
    if (pair.includes(uidA) && pair.includes(uidB)) return slot;
  }
  return null;
}

/** Admin: lock the finals from the current standings and deal the opening ties. */
export async function startFinals(seasonId: string): Promise<void> {
  const callable = httpsCallable<{ seasonId: string }, { ok: boolean }>(functions, "startFinals");
  await mutate(() => callable({ seasonId }));
}

/** Admin: decide an open tie without a match (absence/forfeit). */
export async function awardWalkover(
  seasonId: string,
  slot: FinalsSlotKey,
  winnerId: string,
): Promise<void> {
  const callable = httpsCallable<
    { seasonId: string; slot: FinalsSlotKey; winnerId: string },
    { ok: boolean }
  >(functions, "awardWalkover");
  await mutate(() => callable({ seasonId, slot, winnerId }));
}

export interface SubmitFinalsMatchInput {
  seasonId: string;
  submittedBy: string;
  slot: FinalsSlot;
  homeGoals: number;
  awayGoals: number;
  decidedBy: Exclude<FinalsDecidedBy, "walkover">;
}

/** Record a finals result. The match mirrors the bracket slot exactly (sides, dealt
 *  teams) and must not be level — security rules reject anything else. The normal
 *  pending-confirmation lifecycle applies; the bracket advances on confirmation. */
export async function submitFinalsMatch(input: SubmitFinalsMatchInput): Promise<string> {
  const { slot } = input;
  const ref = await addDoc(collection(db, "matches"), {
    seasonId: input.seasonId,
    submittedBy: input.submittedBy,
    aId: slot.homeId,
    bId: slot.awayId,
    aTeamId: slot.homeTeamId,
    bTeamId: slot.awayTeamId,
    aTeam: slot.homeTeamName,
    bTeam: slot.awayTeamName,
    aGoals: input.homeGoals,
    bGoals: input.awayGoals,
    status: "pending_confirmation",
    source: "finals",
    finals: true,
    finalsSlot: slot.key,
    decidedBy: input.decidedBy,
    date: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  invalidateData();
  return ref.id;
}
