import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { timed } from "../logger";
import { asNullableDate } from "./firestoreMap";
import type { ActivityEvent, ActivityType } from "./types";

const ACTIVITY_TYPES: ActivityType[] = [
  "match_result",
  "upset",
  "streak",
  "new_number_one",
  "potm",
  "premier",
  "champion",
];

function mapActivity(id: string, data: Record<string, unknown>): ActivityEvent | null {
  const type = data.type;
  if (typeof type !== "string" || !ACTIVITY_TYPES.includes(type as ActivityType)) return null;
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : {};
  const actorIds = Array.isArray(data.actorIds)
    ? data.actorIds.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id,
    type: type as ActivityType,
    seasonId: typeof data.seasonId === "string" ? data.seasonId : null,
    actorIds,
    createdAt: asNullableDate(data.createdAt),
    payload,
  };
}

/** Most recent league activity, newest first. Single-field order — no composite index. */
export async function getRecentActivity(max = 20): Promise<ActivityEvent[]> {
  return timed("getRecentActivity", async () => {
    const snap = await getDocs(
      query(collection(db, "activity"), orderBy("createdAt", "desc"), limit(max)),
    );
    return snap.docs
      .map((doc) => mapActivity(doc.id, doc.data()))
      .filter((event): event is ActivityEvent => event !== null);
  });
}
