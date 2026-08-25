import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import type { CupBracket, CupTie } from "./types";

/**
 * The mid-season knockout cup read model. State lives at seasons/{id}/cup/state —
 * member-readable through the seasons subtree rules; only the backend writes it.
 */

/** Normalize one tie row from Firestore, tolerating absent/null sides and winners. */
function mapTie(raw: Record<string, unknown>): CupTie {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    aId: str(raw.aId),
    bId: str(raw.bId),
    winnerId: str(raw.winnerId),
  };
}

/** The season's cup state, or null when no cup has been started for it — or when the
 *  read fails. Callers treat this as banner-optional data: a transient error must hide
 *  the cup card, never fail the whole screen that happens to also fetch it. */
export async function getCup(seasonId: string): Promise<CupState | null> {
  const snap = await getDoc(doc(db, "seasons", seasonId, "cup", "state")).catch(() => null);
  if (!snap || !snap.exists()) return null;
  const data = snap.data();
  const rawRounds = Array.isArray(data.rounds) ? data.rounds : [];
  return {
    status: data.status === "live" ? "live" : "complete",
    rounds: rawRounds.map((round: unknown) =>
      (Array.isArray(round) ? round : []).map((tie: Record<string, unknown>) => mapTie(tie)),
    ),
    seed: Number(data.seed ?? 0),
    createdAtMillis:
      typeof data.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : null,
  };
}

export interface CupState {
  status: "live" | "complete";
  rounds: CupBracket;
  seed: number;
  createdAtMillis: number | null;
}

export type { CupBracket, CupTie };

/**
 * First unresolved tie featuring both players (either side order), or null. Mirrors the
 * backend's pair-matching so the UI can highlight a player's own live tie.
 */
export function openTieForPair(bracket: CupBracket, uidA: string, uidB: string): CupTie | null {
  for (const round of bracket) {
    for (const tie of round) {
      if (tie.winnerId !== null || !tie.aId || !tie.bId) continue;
      if ((tie.aId === uidA && tie.bId === uidB) || (tie.aId === uidB && tie.bId === uidA)) {
        return tie;
      }
    }
  }
  return null;
}

/** Admin: draw the bracket from the current roster and open the cup. */
export async function startCup(seasonId: string): Promise<void> {
  const callable = httpsCallable<{ seasonId: string }, { ok: boolean }>(functions, "startCup");
  await callable({ seasonId });
}

/** Admin: decide a specific stuck tie without a match (absence, void repair). */
export async function forceAdvanceCup(
  seasonId: string,
  roundIndex: number,
  tieIndex: number,
  winnerId: string,
): Promise<void> {
  const callable = httpsCallable<
    { seasonId: string; roundIndex: number; tieIndex: number; winnerId: string },
    { ok: boolean }
  >(functions, "forceAdvanceCup");
  await callable({ seasonId, roundIndex, tieIndex, winnerId });
}
