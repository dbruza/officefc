/* OfficeFC — mock data + derived-stat engine.
   Everything (records, form, H2H, ELO history) is computed from one match list
   so the prototype is internally consistent. Deterministic via a seeded PRNG. */
(function () {
  "use strict";

  // ---- seeded PRNG (mulberry32) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20260603);
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // ---- players ----  (you = p1)
  const players = [
    { id: "p1", name: "Marcus Bell", handle: "marcus", jersey: 10, color: "#00ff87", isYou: true },
    { id: "p2", name: "Dave Okafor", handle: "big_dave", jersey: 9, color: "#ff5470" },
    { id: "p3", name: "Priya Shah", handle: "priya", jersey: 7, color: "#5b9dff" },
    { id: "p4", name: "Tom Nguyen", handle: "tommy", jersey: 4, color: "#ffb020" },
    { id: "p5", name: "Aisha Khan", handle: "aisha", jersey: 11, color: "#c06bff" },
    { id: "p6", name: "Jordan Lee", handle: "jlee", jersey: 6, color: "#36e0c8" },
    { id: "p7", name: "Nina Costa", handle: "nina", jersey: 8, color: "#ff8a3d" },
    { id: "p8", name: "Leo Martins", handle: "leo", jersey: 3, color: "#9aa7ff" },
  ];
  players.forEach((p) => {
    p.initials = p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  });
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));

  // ---- generic team names (NO real clubs) ----
  const teams = [
    "Crimson Albion", "Northgate United", "Royal Vega", "Azzurri Select",
    "Bavaria XI", "La Costa CF", "Harbour City", "Verde Nacional",
    "Iron Foundry", "Capital Athletic", "Sierra Rovers", "Black Forest SV",
    "Oranje Stars", "Maple Wanderers", "Delta Galácticos", "Phoenix Borough",
  ];

  // ---- seasons ----
  const seasons = [
    { id: "s3", name: "Summer Showdown", year: 2026, start: "2026-04-01", end: "2026-06-30", active: true },
    { id: "s2", name: "Spring Cup", year: 2026, start: "2026-01-06", end: "2026-03-31", active: false,
      championId: "p2", runnerUpId: "p3", potm: [{ m: "Jan", playerId: "p2" }, { m: "Feb", playerId: "p6" }, { m: "Mar", playerId: "p2" }] },
    { id: "s1", name: "Winter League", year: 2025, start: "2025-10-01", end: "2025-12-20", active: false,
      championId: "p3", runnerUpId: "p1", potm: [{ m: "Oct", playerId: "p1" }, { m: "Nov", playerId: "p3" }, { m: "Dec", playerId: "p3" }] },
  ];
  const activeSeason = seasons[0];

  // ---- ELO engine ----
  const K = 32, BASE = 1500;
  const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

  // ---- match generation for the active season ----
  // Engineer Marcus(p1) vs Dave(p2) all-time to be a painful 2–9.
  const matches = [];
  let mid = 1;
  const dayMs = 86400000;
  const seasonStart = new Date(activeSeason.start).getTime();

  function score(winnerStronger) {
    // returns [wScore, lScore] for a decisive game, biased to realistic football scores
    const margin = pick([1, 1, 1, 2, 2, 3]);
    const loser = pick([0, 0, 1, 1, 2]);
    return [loser + margin, loser];
  }

  function addMatch(dayOffset, aId, bId, aGoals, bGoals, hasPhoto) {
    const date = new Date(seasonStart + dayOffset * dayMs).toISOString().slice(0, 10);
    matches.push({ id: "m" + mid++, seasonId: activeSeason.id, date, aId, bId, aGoals, bGoals, hasPhoto });
  }

  // Scripted nemesis thread: Marcus vs Dave this season — Dave dominates.
  const mdResults = [ // [marcusGoals, daveGoals] — engineered to a brutal 2–9
    [1, 3], [0, 2], [2, 4], [0, 1], [2, 5],
    [3, 2] /* Marcus W */, [1, 2], [0, 3], [1, 4],
    [2, 1] /* Marcus W */, [2, 3],
  ];
  let d = 1;
  mdResults.forEach((r, i) => { addMatch(d, "p1", "p2", r[0], r[1], i % 2 === 0); d += ri(2, 5); });

  // Other random matches among everyone (incl. Marcus vs others)
  const others = players.map((p) => p.id);
  for (let i = 0; i < 54; i++) {
    let aId = pick(others), bId = pick(others);
    while (bId === aId) bId = pick(others);
    // skip extra Marcus-Dave (already scripted)
    if ((aId === "p1" && bId === "p2") || (aId === "p2" && bId === "p1")) { i--; continue; }
    const aWin = rnd() > 0.5;
    const [w, l] = score(true);
    let ag, bg;
    if (rnd() < 0.16) { const t = pick([0, 1, 1, 2]); ag = t; bg = t; } // draw
    else if (aWin) { ag = w; bg = l; } else { ag = l; bg = w; }
    addMatch(d, aId, bId, ag, bg, rnd() < 0.55);
    d += ri(0, 3);
  }

  // sort chronologically, then process ELO
  matches.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const ratings = Object.fromEntries(players.map((p) => [p.id, BASE]));
  const history = Object.fromEntries(players.map((p) => [p.id, [{ date: activeSeason.start, rating: BASE }]]));
  matches.forEach((m) => {
    const Ra = ratings[m.aId], Rb = ratings[m.bId];
    const Sa = m.aGoals > m.bGoals ? 1 : m.aGoals < m.bGoals ? 0 : 0.5;
    const Sb = 1 - Sa;
    const da = Math.round(K * (Sa - expected(Ra, Rb)));
    const db = Math.round(K * (Sb - expected(Rb, Ra)));
    m.aEloBefore = Ra; m.aEloAfter = Ra + da; m.aDelta = da;
    m.bEloBefore = Rb; m.bEloAfter = Rb + db; m.bDelta = db;
    ratings[m.aId] += da; ratings[m.bId] += db;
    history[m.aId].push({ date: m.date, rating: ratings[m.aId] });
    history[m.bId].push({ date: m.date, rating: ratings[m.bId] });
  });

  // ---- derived helpers ----
  function playerMatches(pid) {
    return matches.filter((m) => m.aId === pid || m.bId === pid)
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  }
  // normalize a match to the perspective of pid -> {opp, gf, ga, res, delta, eloAfter}
  function persp(m, pid) {
    const me = m.aId === pid;
    const gf = me ? m.aGoals : m.bGoals;
    const ga = me ? m.bGoals : m.aGoals;
    return {
      id: m.id, date: m.date, oppId: me ? m.bId : m.aId,
      myTeam: me ? m.aTeam : m.bTeam, oppTeam: me ? m.bTeam : m.aTeam,
      gf, ga, res: gf > ga ? "W" : gf < ga ? "L" : "D",
      delta: me ? m.aDelta : m.bDelta, eloAfter: me ? m.aEloAfter : m.bEloAfter,
      raw: m,
    };
  }
  function record(pid) {
    let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
    playerMatches(pid).forEach((m) => {
      const p = persp(m, pid);
      gf += p.gf; ga += p.ga;
      if (p.res === "W") w++; else if (p.res === "D") dr++; else l++;
    });
    const games = w + dr + l;
    return { w, d: dr, l, games, gf, ga, winRate: games ? Math.round((w / games) * 100) : 0 };
  }
  function formChips(pid, n = 5) {
    return playerMatches(pid).slice(0, n).map((m) => persp(m, pid).res).reverse();
  }
  function streaks(pid) {
    const seq = playerMatches(pid).map((m) => persp(m, pid).res); // newest first
    // current streak (newest run)
    let cur = 0, curType = null;
    for (const r of seq) {
      if (curType === null) { curType = r === "W" ? "W" : r === "D" ? "D" : "L"; cur = 1; }
      else if (r === curType) cur++;
      else break;
    }
    // longest win + unbeaten over chronological order
    const chrono = seq.slice().reverse();
    let lw = 0, bestW = 0, ub = 0, bestUb = 0;
    chrono.forEach((r) => {
      if (r === "W") { lw++; ub++; } else if (r === "D") { lw = 0; ub++; } else { lw = 0; ub = 0; }
      bestW = Math.max(bestW, lw); bestUb = Math.max(bestUb, ub);
    });
    return { current: cur, currentType: curType, longestWin: bestW, longestUnbeaten: bestUb };
  }
  function biggestWin(pid) {
    let best = null, bestMargin = -1;
    playerMatches(pid).forEach((m) => {
      const p = persp(m, pid);
      if (p.res === "W" && p.gf - p.ga > bestMargin) { bestMargin = p.gf - p.ga; best = p; }
    });
    return best;
  }
  function h2h(aId, bId) {
    const list = matches.filter((m) =>
      (m.aId === aId && m.bId === bId) || (m.aId === bId && m.bId === aId))
      .sort((x, y) => (x.date < y.date ? 1 : -1));
    let aw = 0, bw = 0, dr = 0, agf = 0, aga = 0;
    list.forEach((m) => {
      const p = persp(m, aId);
      agf += p.gf; aga += p.ga;
      if (p.res === "W") aw++; else if (p.res === "L") bw++; else dr++;
    });
    return { aId, bId, aWins: aw, bWins: bw, draws: dr, aGF: agf, aGA: aga, meetings: list.map((m) => persp(m, aId)) };
  }
  function standings(seasonId) {
    const inSeason = matches.filter((m) => m.seasonId === seasonId);
    const tbl = {};
    players.forEach((p) => (tbl[p.id] = { id: p.id, w: 0, d: 0, l: 0, gf: 0, ga: 0, elo: ratings[p.id] }));
    inSeason.forEach((m) => {
      const A = tbl[m.aId], B = tbl[m.bId];
      A.gf += m.aGoals; A.ga += m.bGoals; B.gf += m.bGoals; B.ga += m.aGoals;
      if (m.aGoals > m.bGoals) { A.w++; B.l++; } else if (m.aGoals < m.bGoals) { A.l++; B.w++; } else { A.d++; B.d++; }
    });
    const rows = Object.values(tbl).filter((r) => r.w + r.d + r.l > 0)
      .sort((a, b) => b.elo - a.elo);
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.form = formChips(r.id, 5);
      // fake movement from "last week"
      r.move = [0, 1, -1, 2, -2, 0, 1, -1][i % 8];
    });
    return rows;
  }
  function nemesis(pid) {
    // opponent with worst win-share for pid and >=3 games
    let worst = null, worstShare = 2;
    players.forEach((o) => {
      if (o.id === pid) return;
      const h = h2h(pid, o.id);
      const g = h.aWins + h.bWins + h.draws;
      if (g < 3) return;
      const share = (h.aWins + 0.5 * h.draws) / g;
      if (share < worstShare) { worstShare = share; worst = h; }
    });
    return worst;
  }

  // assign teams to matches (deterministic, after sort)
  matches.forEach((m) => { m.aTeam = pick(teams); let b = pick(teams); m.bTeam = b; });

  // archived final standings for past seasons (hand-shaped, plausible)
  const archives = {
    s2: [
      { id: "p2", elo: 1631, w: 14, d: 3, l: 4 }, { id: "p3", elo: 1598, w: 12, d: 4, l: 5 },
      { id: "p6", elo: 1572, w: 11, d: 3, l: 6 }, { id: "p1", elo: 1549, w: 10, d: 4, l: 7 },
      { id: "p5", elo: 1521, w: 9, d: 3, l: 8 }, { id: "p7", elo: 1498, w: 8, d: 2, l: 10 },
      { id: "p4", elo: 1466, w: 6, d: 4, l: 11 }, { id: "p8", elo: 1441, w: 5, d: 3, l: 12 },
    ],
    s1: [
      { id: "p3", elo: 1644, w: 15, d: 2, l: 3 }, { id: "p1", elo: 1612, w: 13, d: 3, l: 4 },
      { id: "p2", elo: 1583, w: 12, d: 2, l: 6 }, { id: "p7", elo: 1540, w: 10, d: 3, l: 7 },
      { id: "p6", elo: 1509, w: 9, d: 2, l: 9 }, { id: "p4", elo: 1487, w: 7, d: 4, l: 9 },
      { id: "p8", elo: 1455, w: 6, d: 2, l: 12 }, { id: "p5", elo: 1438, w: 5, d: 3, l: 12 },
    ],
  };
  archives.s2.forEach((r, i) => (r.rank = i + 1));
  archives.s1.forEach((r, i) => (r.rank = i + 1));

  window.OFC = {
    players, byId, teams, seasons, activeSeason, matches, ratings, history, archives,
    you: byId.p1,
    fns: { playerMatches, persp, record, formChips, streaks, biggestWin, h2h, standings, nemesis },
  };
})();
