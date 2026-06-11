import {
  getFirestore,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { randomCode } from "./config";
import type { SeasonMatchInput } from "./elo";

/** Coerce a Firestore Timestamp or ISO date string to epoch millis; unknown shapes → 0. */
export function dateMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Map a match doc to the season-calculation input; date falls back to confirmedAt → createdAt. */
export function seasonMatchInputFromDoc(snap: QueryDocumentSnapshot): SeasonMatchInput {
  const data = snap.data();
  return {
    id: snap.id,
    aId: String(data.aId),
    bId: String(data.bId),
    aGoals: Number(data.aGoals),
    bGoals: Number(data.bGoals),
    aShotsOnTarget: data.aShotsOnTarget != null ? Number(data.aShotsOnTarget) : null,
    bShotsOnTarget: data.bShotsOnTarget != null ? Number(data.bShotsOnTarget) : null,
    aPossession: data.aPossession != null ? Number(data.aPossession) : null,
    bPossession: data.bPossession != null ? Number(data.bPossession) : null,
    dateMillis: dateMillis(data.date ?? data.confirmedAt ?? data.createdAt),
  };
}

/**
 * Resolve the current team `overall` for every team referenced by the given match docs, keyed by
 * team id. A missing team doc or non-numeric `overall` maps to null, which the ELO calculation
 * treats as "no team handicap". Superseded catalogue teams keep their overall, so historical
 * matches pointing at old team ids still resolve.
 */
async function teamOverallsForMatches(
  db: Firestore,
  matchDocs: QueryDocumentSnapshot[],
): Promise<Map<string, number | null>> {
  const ids = new Set<string>();
  for (const snap of matchDocs) {
    const a = snap.get("aTeamId");
    const b = snap.get("bTeamId");
    if (a) ids.add(String(a));
    if (b) ids.add(String(b));
  }
  const overallById = new Map<string, number | null>();
  if (ids.size === 0) return overallById;
  const idList = [...ids];
  const teamSnaps = await db.getAll(...idList.map((id) => db.doc(`teams/${id}`)));
  teamSnaps.forEach((snap, index) => {
    const overall = snap.get("overall");
    overallById.set(idList[index], typeof overall === "number" ? overall : null);
  });
  return overallById;
}

/**
 * Map match docs to season-calculation inputs, with each side's team `overall` attached so the
 * ELO handicap can be applied. Use this anywhere matches feed `calculateSeason`/`computePOTM` so
 * standings, weekly snapshots, and player-of-the-month all agree on the same handicapped result.
 */
export async function seasonMatchInputsWithTeams(
  matchDocs: QueryDocumentSnapshot[],
  db: Firestore = getFirestore(),
): Promise<SeasonMatchInput[]> {
  const overallById = await teamOverallsForMatches(db, matchDocs);
  return matchDocs.map((snap) => ({
    ...seasonMatchInputFromDoc(snap),
    aTeamOverall: overallById.get(String(snap.get("aTeamId") ?? "")) ?? null,
    bTeamOverall: overallById.get(String(snap.get("bTeamId") ?? "")) ?? null,
  }));
}

/** A join code no other season is using. Throws if 10 random tries all collide. */
export async function generateUniqueJoinCode(): Promise<string> {
  const db = getFirestore();
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const existing = await db.collection("seasons").where("joinCode", "==", code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error("Failed to generate a unique join code after 10 attempts.");
}
