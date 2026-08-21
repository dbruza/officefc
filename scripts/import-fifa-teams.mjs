import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CATALOGUE_VERSION = "fifa23-men-v4";
export const ID_VERSION = "fifa23";

export const NATIONAL_TEAMS = [
  ["nt-england", "England", 84, 85, 83, 82],
  ["nt-spain", "Spain", 83, 83, 84, 83],
  ["nt-france", "France", 83, 85, 83, 83],
  ["nt-germany", "Germany", 83, 80, 84, 80],
  ["nt-portugal", "Portugal", 83, 84, 84, 83],
  ["nt-argentina", "Argentina", 83, 84, 81, 82],
  ["nt-netherlands", "Netherlands", 82, 83, 81, 82],
  ["nt-italy", "Italy", 82, 81, 85, 81],
  ["nt-belgium", "Belgium", 80, 81, 78, 78],
  ["nt-brazil", "Brazil", 80, 81, 80, 80],
  ["nt-croatia", "Croatia", 79, 77, 82, 78],
  ["nt-denmark", "Denmark", 78, 75, 79, 79],
  ["nt-austria", "Austria", 77, 78, 78, 77],
  ["nt-morocco", "Morocco", 77, 77, 76, 78],
  ["nt-mexico", "Mexico", 77, 78, 77, 76],
  ["nt-poland", "Poland", 77, 79, 76, 75],
  ["nt-sweden", "Sweden", 76, 78, 77, 75],
  ["nt-norway", "Norway", 76, 82, 78, 74],
  ["nt-czech-republic", "Czech Republic", 76, 77, 77, 75],
  ["nt-scotland", "Scotland", 75, 72, 75, 76],
  ["nt-ukraine", "Ukraine", 75, 74, 77, 72],
  ["nt-united-states", "United States", 75, 74, 75, 74],
  ["nt-ghana", "Ghana", 75, 81, 75, 74],
  ["nt-wales", "Wales", 73, 74, 72, 73],
  ["nt-canada", "Canada", 73, 77, 73, 70],
  ["nt-hungary", "Hungary", 73, 76, 72, 73],
  ["nt-ireland", "Ireland", 72, 69, 71, 73],
  ["nt-romania", "Romania", 71, 70, 73, 69],
  ["nt-australia", "Australia", 71, 70, 71, 70],
  ["nt-finland", "Finland", 71, 72, 71, 68],
  ["nt-iceland", "Iceland", 70, 70, 68, 71],
  ["nt-china-pr", "China PR", 69, 70, 68, 67],
  ["nt-northern-ireland", "Northern Ireland", 69, 66, 69, 71],
  ["nt-qatar", "Qatar", 68, 71, 69, 68],
  ["nt-new-zealand", "New Zealand", 66, 67, 64, 65],
];

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function stableTeamId(team, competition, version = ID_VERSION) {
  const identity = `${version}\u0000${team}\u0000${competition}`;
  const hash = createHash("sha1").update(identity).digest("hex").slice(0, 10);
  return `${version}-${slugify(team) || "team"}-${hash}`;
}

export function categoryForCompetition(competition) {
  return /women|féminine|feminine|nwsl/i.test(competition) ? "women" : "men";
}

export function parseTeamDump(
  source,
  catalogueVersion = CATALOGUE_VERSION,
  idVersion = ID_VERSION,
) {
  const lines = source
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const teams = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index];
    if (/^Team\tLeague\tOVR\tATK\tMID\tDEF$/i.test(name)) continue;
    if (/^(Previous|Next|\d+\s*\/\s*\d+)$/i.test(name)) continue;

    const statsLine = lines[index + 1];
    const match = statsLine?.match(/^(.+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)$/);
    if (!match) {
      throw new Error(`Malformed FIFA team row near line ${index + 1}: ${name}`);
    }

    const [, competition, overallRaw, attackRaw, midfieldRaw, defenceRaw] = match;
    const ratings = [overallRaw, attackRaw, midfieldRaw, defenceRaw].map(Number);
    if (ratings.some((rating) => !Number.isInteger(rating) || rating < 1 || rating > 99)) {
      throw new Error(`Invalid ratings for ${name} (${competition})`);
    }

    const [overall, attack, midfield, defence] = ratings;
    const identity = `${name}\u0000${competition}`;
    const existing = teams.get(identity);
    const next = {
      id: stableTeamId(name, competition, idVersion),
      name,
      competition,
      category: categoryForCompetition(competition),
      overall,
      attack,
      midfield,
      defence,
      catalogueVersion,
    };
    if (existing && JSON.stringify(existing) !== JSON.stringify(next)) {
      throw new Error(`Conflicting duplicate for ${name} (${competition})`);
    }
    teams.set(identity, next);
    index += 1;
  }

  const result = [...teams.values()].sort(
    (a, b) =>
      b.overall - a.overall ||
      a.name.localeCompare(b.name) ||
      a.competition.localeCompare(b.competition),
  );
  const ids = new Set();
  for (const team of result) {
    if (ids.has(team.id)) throw new Error(`Generated id collision: ${team.id}`);
    ids.add(team.id);
  }
  return result;
}

export function buildCatalogue(source, version = CATALOGUE_VERSION) {
  const clubs = parseTeamDump(source, version, ID_VERSION).filter(
    (team) => team.category === "men",
  );
  const nationalTeams = NATIONAL_TEAMS.map(([id, name, overall, attack, midfield, defence]) => ({
    id,
    name,
    competition: "National Teams",
    category: "international",
    overall,
    attack,
    midfield,
    defence,
    catalogueVersion: version,
  }));
  return [...clubs, ...nationalTeams].sort(
    (a, b) =>
      (b.overall ?? -1) - (a.overall ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.competition.localeCompare(b.competition),
  );
}

export function renderTypeScript(teams, version = CATALOGUE_VERSION) {
  return `// Generated by scripts/import-fifa-teams.mjs. Do not edit by hand.
export type TeamCategory = "men" | "international";

export interface CatalogueTeam {
  id: string;
  name: string;
  competition: string;
  category: TeamCategory;
  overall: number | null;
  attack: number | null;
  midfield: number | null;
  defence: number | null;
  catalogueVersion: string;
}

export const TEAM_CATALOGUE_VERSION = ${JSON.stringify(version)};
export const TEAM_CATALOGUE: CatalogueTeam[] = ${JSON.stringify(teams, null, 2)};
`;
}

function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    throw new Error(
      "Usage: node scripts/import-fifa-teams.mjs <team-dump.txt> <generated-catalogue.ts>",
    );
  }
  const teams = buildCatalogue(readFileSync(resolve(input), "utf8"));
  writeFileSync(resolve(output), renderTypeScript(teams), "utf8");
  const competitions = new Set(teams.map((team) => team.competition));
  const ratings = teams.flatMap((team) => (team.overall == null ? [] : [team.overall]));
  console.log(
    `Generated ${teams.length} teams across ${competitions.size} competitions ` +
      `(OVR ${Math.min(...ratings)}-${Math.max(...ratings)}).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
