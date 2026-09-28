function normalizeTeamSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inOverallBand(overall, band) {
  if (band === "all") return true;
  if (band === "unrated") return overall == null;
  if (overall == null) return false;
  if (band === "80+") return overall >= 80;
  if (band === "75-79") return overall >= 75 && overall <= 79;
  if (band === "70-74") return overall >= 70 && overall <= 74;
  return overall < 70;
}

function searchRank(team, normalizedQuery) {
  if (!normalizedQuery) return 0;
  const name = normalizeTeamSearch(team.name);
  const competition = normalizeTeamSearch(team.competition);
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (competition.startsWith(normalizedQuery)) return 3;
  if (competition.includes(normalizedQuery)) return 4;
  return Number.POSITIVE_INFINITY;
}

function filterTeams(teams, filters) {
  const query = normalizeTeamSearch(filters.query);
  return teams
    .filter((team) => filters.category === "all" || team.category === filters.category)
    .filter((team) => inOverallBand(team.overall, filters.overall))
    .map((team) => ({ team, rank: searchRank(team, query) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.team.overall ?? -1) - (a.team.overall ?? -1) ||
        a.team.name.localeCompare(b.team.name) ||
        a.team.competition.localeCompare(b.team.competition),
    )
    .map((entry) => entry.team);
}

// Words that only decorate a club's name ("FC Barcelona", "Liverpool FC", "SSC Napoli",
// "Atlético de Madrid"). They're dropped before comparing, so the name a stats screen prints
// still finds the catalogue team whichever affixes either side carries.
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

/** Lowercase, accent-free, punctuation-free form of a team name, words single-spaced. */
function normalizeTeamName(value) {
  return normalizeTeamSearch(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A team name reduced to its distinctive words: affixes and bare years/numbers removed. */
function teamNameCore(value) {
  return normalizeTeamName(value)
    .split(" ")
    .filter((word) => word && !CLUB_AFFIXES.has(word) && !/^\d+$/.test(word))
    .join(" ");
}

// Names a stats screen may print that don't contain the catalogue name: short forms,
// nicknames and scoreboard codes. Values are catalogue team names (resolved by their core, so
// affix changes between game editions don't break them); null marks a genuinely ambiguous name
// ("Paris" is both Paris FC and Paris Saint-Germain) that must never be auto-picked. A test
// checks every target against the bundled catalogue, so a renamed club fails loudly on the next
// catalogue import instead of silently never matching.
const TEAM_ALIASES = {
  // England
  ars: "Arsenal FC",
  avl: "Aston Villa",
  bha: "Brighton & Hove Albion",
  che: "Chelsea FC",
  liv: "Liverpool FC",
  "man city": "Manchester City",
  mci: "Manchester City",
  "man utd": "Manchester United",
  "man united": "Manchester United",
  "manchester utd": "Manchester United",
  mun: "Manchester United",
  nfo: "Nottingham Forest",
  spurs: "Tottenham Hotspur",
  tot: "Tottenham Hotspur",
  whu: "West Ham United",
  wolves: "Wolverhampton Wanderers",
  // Spain
  atm: "Atlético Madrid",
  atleti: "Atlético Madrid",
  atletico: "Atlético Madrid",
  "athletic bilbao": "Athletic Club",
  bar: "FC Barcelona",
  barca: "FC Barcelona",
  rma: "Real Madrid",
  // Italy
  inter: "Inter Milan",
  internazionale: "Inter Milan",
  juve: "Juventus FC",
  juv: "Juventus FC",
  mil: "AC Milan",
  nap: "SSC Napoli",
  // Germany
  b04: "Bayer 04 Leverkusen",
  "bayern munich": "Bayern München",
  bvb: "Borussia Dortmund",
  gladbach: "Borussia Mönchengladbach",
  rbl: "RB Leipzig",
  // France
  lyon: "Olympique Lyonnais",
  om: "Olympique de Marseille",
  ol: "Olympique Lyonnais",
  paris: null,
  "paris sg": "Paris Saint-Germain",
  psg: "Paris Saint-Germain",
};

const ALIAS_CORES = new Map(
  Object.entries(TEAM_ALIASES).map(([alias, target]) => [
    normalizeTeamName(alias),
    target === null ? null : teamNameCore(target),
  ]),
);

const AMBIGUOUS = Symbol("ambiguous");

/** The single team satisfying `predicate`, AMBIGUOUS when several do, null when none. */
function uniqueTeam(entries, predicate) {
  const hits = entries.filter(predicate);
  if (hits.length > 1) return AMBIGUOUS;
  return hits.length === 1 ? hits[0].team : null;
}

/** Resolve an alias key to its team: AMBIGUOUS for a null alias, null when not an alias. */
function aliasTeam(entries, key) {
  if (!ALIAS_CORES.has(key)) return null;
  const targetCore = ALIAS_CORES.get(key);
  if (targetCore === null) return AMBIGUOUS;
  return uniqueTeam(entries, (entry) => entry.core === targetCore);
}

/**
 * The catalogue team a stats screen's printed team name refers to, or null when it can't be
 * pinned down. Unlike search, this never guesses between candidates: a wrong team silently skews
 * the ELO team-strength handicap, so an ambiguous name ("Manchester", "Paris") returns null and
 * the player picks. Tries, in order: exact name, alias, name without club affixes ("Barcelona"
 * → "FC Barcelona"), then a whole-word match that only one team has ("Dortmund").
 */
function matchTeamName(teams, name) {
  const query = normalizeTeamName(name);
  if (!query) return null;
  const entries = teams.map((team) => ({
    team,
    full: normalizeTeamName(team.name),
    core: teamNameCore(team.name),
  }));
  const queryCore = teamNameCore(query);
  const steps = [
    () => uniqueTeam(entries, (entry) => entry.full === query),
    () => aliasTeam(entries, query),
    () => (queryCore ? uniqueTeam(entries, (entry) => entry.core === queryCore) : null),
    () => (queryCore && queryCore !== query ? aliasTeam(entries, queryCore) : null),
    () =>
      queryCore
        ? uniqueTeam(entries, (entry) => ` ${entry.core} `.includes(` ${queryCore} `))
        : null,
  ];
  for (const step of steps) {
    const result = step();
    if (result === AMBIGUOUS) return null;
    if (result) return result;
  }
  return null;
}

module.exports = {
  TEAM_ALIASES,
  filterTeams,
  matchTeamName,
  normalizeTeamName,
  normalizeTeamSearch,
  teamNameCore,
};
