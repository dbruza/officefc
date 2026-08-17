import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { timed } from "../logger";
import { asDate, asNullableDate } from "./firestoreMap";
import type { PotmResult, Season, SeasonResult } from "./types";

function mapSeason(id: string, data: Record<string, unknown>): Season {
  const phase = data.phase === "finals" || data.phase === "finalized" ? data.phase : "regular";
  return {
    id,
    name: String(data.name),
    year: Number(data.year),
    start: asDate(data.start),
    end: asDate(data.end),
    active: data.active === true,
    phase,
    reigningPremierId:
      typeof data.reigningPremierId === "string" ? (data.reigningPremierId as string) : null,
  };
}

function mapSeasonResult(id: string, get: (field: string) => unknown): SeasonResult {
  return {
    seasonId: id,
    championId: String(get("championId")),
    runnerUpId: String(get("runnerUpId")),
    premierId: typeof get("premierId") === "string" ? (get("premierId") as string) : null,
    format: get("format") === "finals" ? "finals" : "table",
    finalizedAt: asNullableDate(get("finalizedAt")),
  };
}

export async function getActiveSeason(): Promise<Season | null> {
  return timed("getActiveSeason", async () => {
    const snap = await getDocs(
      query(collection(db, "seasons"), where("active", "==", true), limit(1)),
    );
    const doc = snap.docs[0];
    if (!doc) return null;
    return mapSeason(doc.id, doc.data());
  });
}

export async function getSeasons(): Promise<Season[]> {
  const snap = await getDocs(collection(db, "seasons"));
  return snap.docs
    .map((seasonDoc) => mapSeason(seasonDoc.id, seasonDoc.data()))
    .sort((a, b) => b.start.getTime() - a.start.getTime());
}

export async function getSeason(seasonId: string): Promise<Season | null> {
  const snap = await getDoc(doc(db, "seasons", seasonId));
  if (!snap.exists()) return null;
  return mapSeason(snap.id, snap.data());
}

export async function getSeasonResult(seasonId: string): Promise<SeasonResult | null> {
  const snap = await getDoc(doc(db, "seasonResults", seasonId));
  if (!snap.exists()) return null;
  return mapSeasonResult(seasonId, (field) => snap.get(field));
}

/** All finalized season results, most recently finalized first. */
export async function getSeasonResults(): Promise<SeasonResult[]> {
  const snap = await getDocs(collection(db, "seasonResults"));
  return snap.docs
    .map((resultDoc) => mapSeasonResult(resultDoc.id, (field) => resultDoc.get(field)))
    .sort((a, b) => (b.finalizedAt?.getTime() ?? 0) - (a.finalizedAt?.getTime() ?? 0));
}

export async function getSeasonPotm(seasonId: string): Promise<PotmResult[]> {
  const snap = await getDocs(collection(db, "seasonResults", seasonId, "potm"));
  return snap.docs
    .map((potmDoc) => ({ month: potmDoc.id, playerId: String(potmDoc.get("playerId")) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function createSeason(
  name: string,
  start: string,
  end: string,
): Promise<{ seasonId: string }> {
  const callable = httpsCallable<
    { name: string; start: string; end: string },
    { ok: boolean; seasonId: string }
  >(functions, "createSeason");
  const result = await callable({ name, start, end });
  return result.data;
}

export async function activateSeason(seasonId: string): Promise<{ seasonId: string }> {
  const callable = httpsCallable<{ seasonId: string }, { ok: boolean; seasonId: string }>(
    functions,
    "activateSeason",
  );
  const result = await callable({ seasonId });
  return result.data;
}

export async function finalizeSeason(
  seasonId: string,
  force = false,
): Promise<{ championId: string | null; runnerUpId: string | null; potmCount: number }> {
  const callable = httpsCallable<
    { seasonId: string; force?: boolean },
    { ok: boolean; championId: string | null; runnerUpId: string | null; potmCount: number }
  >(functions, "finalizeSeason");
  const result = await callable({ seasonId, force });
  return result.data;
}

export async function listSeasons(): Promise<
  Array<{ id: string; name: string; active: boolean; finalized: boolean }>
> {
  const callable = httpsCallable<
    Record<string, never>,
    Array<{ id: string; name: string; active: boolean; finalized: boolean }>
  >(functions, "listSeasons");
  const result = await callable({});
  return result.data;
}
