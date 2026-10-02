import { mutate } from "../dataCache";
import { dataCache } from "../dataCache";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import type { Team, TeamCatalogueSyncResult } from "./types";

function nullableTeamRating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapTeam(id: string, data: Record<string, unknown>): Team {
  const source = data.source === "custom" || id.startsWith("team-") ? "custom" : "catalogue";
  return {
    id,
    name: String(data.name ?? ""),
    competition:
      source === "custom" ? String(data.competition ?? "Custom") : String(data.competition ?? ""),
    category:
      source === "custom" ? "custom" : data.category === "international" ? "international" : "men",
    overall: nullableTeamRating(data.overall),
    attack: nullableTeamRating(data.attack),
    midfield: nullableTeamRating(data.midfield),
    defence: nullableTeamRating(data.defence),
    catalogueVersion: typeof data.catalogueVersion === "string" ? data.catalogueVersion : null,
    source,
    catalogueActive: source === "custom" || data.catalogueActive !== false,
    active: data.active !== false,
  };
}

function sortTeams(teams: Team[]): Team[] {
  return teams.sort(
    (a, b) =>
      (b.overall ?? -1) - (a.overall ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.competition.localeCompare(b.competition),
  );
}

export async function getTeams(includeInactive = false): Promise<Team[]> {
  return dataCache.read(
    `teams:${includeInactive}`,
    async () => {
      if (!includeInactive) {
        const snapshot = await getDoc(doc(db, "teamCatalogues", "current"));
        const teams = snapshot.exists() ? snapshot.get("teams") : null;
        if (Array.isArray(teams)) {
          return sortTeams(
            teams
              .filter((team) => (team as Record<string, unknown>).category !== "women")
              .map((team) => {
                const data = team as Record<string, unknown>;
                return mapTeam(String(data.id ?? ""), data);
              }),
          );
        }
      }

      const snap = includeInactive
        ? await getDocs(collection(db, "teams"))
        : await getDocs(query(collection(db, "teams"), where("active", "==", true)));
      return sortTeams(
        snap.docs
          .filter((teamDoc) => teamDoc.get("category") !== "women")
          .map((teamDoc) => mapTeam(teamDoc.id, teamDoc.data())),
      );
    },
    300000,
  );
}

export async function seedTeams(): Promise<TeamCatalogueSyncResult> {
  const callable = httpsCallable<Record<string, never>, { ok: boolean } & TeamCatalogueSyncResult>(
    functions,
    "seedTeams",
  );
  const result = await mutate(() => callable({}));
  return result.data;
}

export async function manageTeam(
  action: "add",
  name: string,
): Promise<{ teamId: string; name: string }>;
export async function manageTeam(
  action: "rename" | "deactivate" | "reactivate",
  teamId: string,
  name?: string,
): Promise<{ teamId: string }>;
export async function manageTeam(
  action: string,
  teamIdOrName: string,
  name?: string,
): Promise<Record<string, string>> {
  const callable = httpsCallable<Record<string, string>, Record<string, string>>(
    functions,
    "manageTeam",
  );
  const data: Record<string, string> = { action };
  if (action === "add") data.name = teamIdOrName;
  else {
    data.teamId = teamIdOrName;
    if (name) data.name = name;
  }
  const result = await mutate(() => callable(data));
  return result.data;
}
