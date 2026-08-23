import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";
import { asNullableDate } from "./firestoreMap";
import type { HeadToHead } from "./types";

export function h2hPairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join("__");
}

function mapHeadToHead(id: string, data: Record<string, unknown>): HeadToHead {
  const meetings = Array.isArray(data.meetings) ? data.meetings : [];
  return {
    pairKey: id,
    aId: String(data.aId),
    bId: String(data.bId),
    aWins: Number(data.aWins),
    bWins: Number(data.bWins),
    draws: Number(data.draws),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    meetings: meetings.map((meeting) => ({
      matchId: String(meeting.matchId),
      seasonId: String(meeting.seasonId),
      date: asNullableDate(meeting.date),
      aGoals: Number(meeting.aGoals),
      bGoals: Number(meeting.bGoals),
      aDelta: Number(meeting.aDelta ?? 0),
      bDelta: Number(meeting.bDelta ?? 0),
    })),
  };
}

export async function getHeadToHead(aId: string, bId: string): Promise<HeadToHead | null> {
  const snap = await getDoc(doc(db, "h2h", h2hPairKey(aId, bId)));
  if (!snap.exists()) return null;
  return mapHeadToHead(snap.id, snap.data());
}

/** All pair summaries involving `uid`. Two indexed queries (as aId / as bId) instead of
 *  downloading the entire league's h2h collection and filtering client-side — the old
 *  scan grew linearly with the square of league membership on every profile view. */
export async function getHeadToHeadsForPlayer(uid: string): Promise<HeadToHead[]> {
  return timed("getHeadToHeadsForPlayer", async () => {
    const h2hCol = collection(db, "h2h");
    const [aSnap, bSnap] = await Promise.all([
      getDocs(query(h2hCol, where("aId", "==", uid))),
      getDocs(query(h2hCol, where("bId", "==", uid))),
    ]);
    // A doc can't be both, but dedupe by id anyway in case of future schema overlap.
    const byId = new Map<string, HeadToHead>();
    for (const h2hDoc of [...aSnap.docs, ...bSnap.docs]) {
      byId.set(h2hDoc.id, mapHeadToHead(h2hDoc.id, h2hDoc.data()));
    }
    return [...byId.values()];
  });
}
