import { loggedOnCall } from "./logging";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireAuth, assertAdmin } from "./auth";
import { TEAM_CATALOGUE, TEAM_CATALOGUE_VERSION, type CatalogueTeam } from "./data/teamCatalogue";

export type TeamSource = "catalogue" | "custom";
export type TeamCategory = "men" | "international" | "custom";

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

export function isWomenTeam(data: Record<string, unknown>): boolean {
  return (
    data.category === "women" ||
    /women|féminine|feminine|nwsl/i.test(String(data.competition ?? ""))
  );
}

export function isSupersededCatalogueTeam(
  id: string,
  data: Record<string, unknown>,
  catalogueIds: Set<string>,
): boolean {
  return !catalogueIds.has(id) && !isCustomTeam(id, data);
}

// Words that only decorate a club's name ("FC", "AC", "de", …). Keep in step with
// CLUB_AFFIXES in mobile/src/lib/teamSearch.js; a root test checks the two agree.
const CLUB_AFFIXES = new Set([
  "ac",
  "afc",
  "as",
  "ca",
  "calcio",
  "cd",
  "cf",
  "club",
  "de",
  "del",
  "fc",
  "losc",
  "ogc",
  "rc",
  "rcd",
  "sc",
  "sd",
  "ss",
  "ssc",
  "sv",
  "tsg",
  "ud",
  "vfb",
  "vfl",
]);

/**
 * A team name reduced to its distinctive words, so a club keeps one identity when a new game
 * edition renames it ("Chelsea" → "Chelsea FC", "Atlético de Madrid" → "Atlético Madrid").
 */
export function teamNameKey(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !CLUB_AFFIXES.has(word) && !/^\d+$/.test(word))
    .join(" ");
}

export interface CarriedOverrides {
  sourceId: string;
  nameOverride: string | null;
  activeOverride: boolean | null;
}

function adminOverrides(data: Record<string, unknown>): {
  nameOverride: string | null;
  activeOverride: boolean | null;
} {
  return {
    nameOverride:
      typeof data.nameOverride === "string" && data.nameOverride.trim()
        ? data.nameOverride.trim()
        : null,
    activeOverride: typeof data.activeOverride === "boolean" ? data.activeOverride : null,
  };
}

/**
 * Admin renames and hides made on a club in the outgoing catalogue, re-keyed to the same club
 * in the incoming one. Catalogue ids change with every game edition, so without this a sync
 * would silently drop them. Sources are catalogue docs this version retires (now, or in an
 * earlier run of the same version) whose overrides haven't been carried yet; a source's
 * target is the one incoming team of the same category with the same name key. The target's
 * own overrides win, and any ambiguous pairing is skipped rather than guessed.
 */
export function planOverrideCarryOver(
  catalogue: CatalogueTeam[],
  existing: Array<{ id: string; data: Record<string, unknown> }>,
  catalogueVersion: string,
): Map<string, CarriedOverrides> {
  const catalogueIds = new Set(catalogue.map((team) => team.id));
  const existingById = new Map(existing.map((doc) => [doc.id, doc.data]));
  const targetsByKey = new Map<string, CatalogueTeam[]>();
  for (const team of catalogue) {
    const key = `${team.category}:${teamNameKey(team.name)}`;
    targetsByKey.set(key, [...(targetsByKey.get(key) ?? []), team]);
  }

  const candidates = new Map<string, CarriedOverrides[]>();
  for (const { id, data } of existing) {
    if (!isSupersededCatalogueTeam(id, data, catalogueIds) || isWomenTeam(data)) continue;
    if (typeof data.overridesCarriedTo === "string") continue;
    const retiredByThisVersion =
      data.catalogueActive !== false || data.supersededByVersion === catalogueVersion;
    if (!retiredByThisVersion) continue;
    const overrides = adminOverrides(data);
    if (overrides.nameOverride === null && overrides.activeOverride === null) continue;

    const key = `${data.category}:${teamNameKey(data.catalogueName ?? data.name)}`;
    const targets = targetsByKey.get(key) ?? [];
    if (targets.length !== 1) continue;
    const [target] = targets;
    const targetOwn = adminOverrides(existingById.get(target.id) ?? {});
    if (targetOwn.nameOverride !== null || targetOwn.activeOverride !== null) continue;
    candidates.set(target.id, [
      ...(candidates.get(target.id) ?? []),
      { sourceId: id, ...overrides },
    ]);
  }

  const plan = new Map<string, CarriedOverrides>();
  for (const [targetId, sources] of candidates) {
    if (sources.length === 1) plan.set(targetId, sources[0]);
  }
  return plan;
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
    category:
      source === "custom" ? "custom" : data.category === "international" ? "international" : "men",
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
  deleted: number;
  active: number;
  /** Retired teams whose admin rename/hide moved onto the same club in this catalogue. */
  overridesCarried: number;
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
      deleted: 0,
      active: Number(currentSnapshot.get("count") ?? 0),
      overridesCarried: 0,
      skipped: true,
    };
  }

  const existing = await db.collection("teams").get();
  const existingById = new Map(existing.docs.map((doc) => [doc.id, doc.data()]));
  const catalogueIds = new Set(TEAM_CATALOGUE.map((team) => team.id));
  const carryOver = planOverrideCarryOver(
    TEAM_CATALOGUE,
    existing.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    TEAM_CATALOGUE_VERSION,
  );
  const carriedTo = new Map(
    [...carryOver].map(([targetId, carried]) => [carried.sourceId, targetId]),
  );
  const writer = db.bulkWriter();

  for (const team of TEAM_CATALOGUE) {
    const carried = carryOver.get(team.id);
    const previous = {
      ...(existingById.get(team.id) ?? {}),
      ...(carried
        ? { nameOverride: carried.nameOverride, activeOverride: carried.activeOverride }
        : {}),
    };
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
  let deleted = 0;
  for (const doc of existing.docs) {
    if (isWomenTeam(doc.data())) {
      writer.delete(doc.ref);
      deleted += 1;
      continue;
    }
    if (isSupersededCatalogueTeam(doc.id, doc.data(), catalogueIds)) {
      // Stamp the retiring version once, so older retirees keep the version that retired them.
      const data = doc.data();
      const retiringNow = data.catalogueActive !== false || !data.supersededByVersion;
      const overridesCarriedTo = carriedTo.get(doc.id);
      writer.set(
        doc.ref,
        {
          source: "catalogue",
          catalogueActive: false,
          active: false,
          ...(retiringNow ? { supersededByVersion: TEAM_CATALOGUE_VERSION } : {}),
          ...(overridesCarriedTo ? { overridesCarriedTo } : {}),
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
    deleted,
    active,
    overridesCarried: carryOver.size,
    skipped: false,
  };
}

/** Admin-only: update Firestore to the bundled catalogue version. */
export const seedTeams = loggedOnCall("seedTeams", { cors: true }, async (req) => {
  const { uid } = requireAuth(req);
  await assertAdmin(uid);
  const result = await seedTeamCatalogue({ force: true });
  return { ok: true, ...result };
});
