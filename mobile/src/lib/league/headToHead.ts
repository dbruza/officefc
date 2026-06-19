import { collection, doc, getDoc, getDocs } from "firebase/firestore";
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

export async function getHeadToHeadsForPlayer(uid: string): Promise<HeadToHead[]> {
  return timed("getHeadToHeadsForPlayer", async () => {
    const snap = await getDocs(collection(db, "h2h"));
    return snap.docs
      .filter((h2hDoc) => h2hDoc.get("aId") === uid || h2hDoc.get("bId") === uid)
      .map((h2hDoc) => mapHeadToHead(h2hDoc.id, h2hDoc.data()));
  });
}
