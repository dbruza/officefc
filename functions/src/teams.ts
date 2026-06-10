import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { TEAM_CATALOGUE, TEAM_CATALOGUE_VERSION, type CatalogueTeam } from "./data/teamCatalogue";

export type TeamSource = "catalogue" | "custom";
export type TeamCategory = "men" | "women" | "custom";

export interface TeamSummary {
  id: string;
  name: string;
  competition: string;
  category: TeamCategory;
  overall: number | null;
  attack: number | null;
  midfield: number | null;
  defence: number | null;
  catalogueVersion: string | null;
  source: TeamSource;
  catalogueActive: boolean;
  active: boolean;
}

export function isCustomTeam(id: string, data: Record<string, unknown>): boolean {
  return data.source === "custom" || id.startsWith("team-");
}

export function isSupersededCatalogueTeam(
  id: string,
  data: Record<string, unknown>,
  catalogueIds: Set<string>,
): boolean {
  return !catalogueIds.has(id) && !isCustomTeam(id, data);
}

export function catalogueTeamData(
  team: CatalogueTeam,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const nameOverride =
    typeof previous.nameOverride === "string" && previous.nameOverride.trim()
      ? previous.nameOverride.trim()
      : null;
  const activeOverride =
    typeof previous.activeOverride === "boolean" ? previous.activeOverride : null;
  return {
    name: nameOverride ?? team.name,
    catalogueName: team.name,
    nameOverride,
    competition: team.competition,
    category: team.category,
    overall: team.overall,
    attack: team.attack,
    midfield: team.midfield,
    defence: team.defence,
    catalogueVersion: team.catalogueVersion,
    source: "catalogue",
    catalogueActive: true,
    active: activeOverride ?? true,
    activeOverride,
  };
}

function nullableRating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function teamSummary(id: string, data: Record<string, unknown>): TeamSummary {
  const source: TeamSource = isCustomTeam(id, data) ? "custom" : "catalogue";
  return {
    id,
    name: String(data.name ?? ""),
    competition:
      source === "custom" ? String(data.competition ?? "Custom") : String(data.competition ?? ""),
    category: source === "custom" ? "custom" : data.category === "women" ? "women" : "men",
    overall: nullableRating(data.overall),
    attack: nullableRating(data.attack),
    midfield: nullableRating(data.midfield),
    defence: nullableRating(data.defence),
    catalogueVersion: typeof data.catalogueVersion === "string" ? data.catalogueVersion : null,
    source,
    catalogueActive: source === "custom" || data.catalogueActive !== false,
    active: data.active === true,
  };
}

export async function rebuildTeamCatalogueSnapshot(
  db: Firestore = getFirestore(),
  installedVersion?: string,
): Promise<TeamSummary[]> {
  const snap = await db.collection("teams").where("active", "==", true).get();
  const teams = snap.docs
    .map((doc) => teamSummary(doc.id, doc.data()))
    .sort(
      (a, b) =>
        (b.overall ?? -1) - (a.overall ?? -1) ||
        a.name.localeCompare(b.name) ||
        a.competition.localeCompare(b.competition),
    );

  const snapshotRef = db.doc("teamCatalogues/current");
  let version = installedVersion;
  if (version === undefined) {
    const current = await snapshotRef.get();
    version =
      current.exists && typeof current.get("version") === "string"
        ? String(current.get("version"))
        : undefined;
  }

  await snapshotRef.set({
    version: version ?? null,
    count: teams.length,
    teams,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return teams;
}

export interface CatalogueSyncResult {
  version: string;
  updated: number;
  deactivated: number;
  active: number;
  skipped: boolean;
}

/** Upsert the current catalogue, preserve admin overrides, and deactivate superseded entries. */
export async function seedTeamCatalogue(
  options: {
    force?: boolean;
    db?: Firestore;
  } = {},
): Promise<CatalogueSyncResult> {
  const db = options.db ?? getFirestore();
  const snapshotRef = db.doc("teamCatalogues/current");
  const currentSnapshot = await snapshotRef.get();
  if (
    !options.force &&
    currentSnapshot.exists &&
    currentSnapshot.get("version") === TEAM_CATALOGUE_VERSION
  ) {
    return {
      version: TEAM_CATALOGUE_VERSION,
      updated: 0,
      deactivated: 0,
      active: Number(currentSnapshot.get("count") ?? 0),
      skipped: true,
    };
  }

  const existing = await db.collection("teams").get();
  const existingById = new Map(existing.docs.map((doc) => [doc.id, doc.data()]));
  const catalogueIds = new Set(TEAM_CATALOGUE.map((team) => team.id));
  const writer = db.bulkWriter();

  for (const team of TEAM_CATALOGUE) {
    const previous = existingById.get(team.id) ?? {};
    writer.set(
      db.doc(`teams/${team.id}`),
      {
        ...catalogueTeamData(team, previous),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  let deactivated = 0;
  for (const doc of existing.docs) {
    if (isSupersededCatalogueTeam(doc.id, doc.data(), catalogueIds)) {
      writer.set(
        doc.ref,
        {
          source: "catalogue",
          catalogueActive: false,
          active: false,
          supersededByVersion: TEAM_CATALOGUE_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      deactivated += 1;
    }
  }

  await writer.close();
  const active = (await rebuildTeamCatalogueSnapshot(db, TEAM_CATALOGUE_VERSION)).length;
  return {
    version: TEAM_CATALOGUE_VERSION,
    updated: TEAM_CATALOGUE.length,
    deactivated,
    active,
    skipped: false,
  };
}

/** Admin-only: update Firestore to the bundled catalogue version. */
export const seedTeams = onCall({ cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const result = await seedTeamCatalogue({ force: true });
  return { ok: true, ...result };
});
