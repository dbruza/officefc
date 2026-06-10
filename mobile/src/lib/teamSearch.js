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

module.exports = { filterTeams, normalizeTeamSearch };
