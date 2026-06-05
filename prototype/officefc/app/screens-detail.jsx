/* OfficeFC — detail screens: player profile, match detail, H2H, archive, setup. */

/* faux "end-of-match stats screen" (stands in for an uploaded photo) */
const StatsShot = ({ m, compact }) => {
  // deterministic-ish fake stats from the score
  const poss = 38 + ((m.aGoals * 7 + m.bGoals * 3) % 24);
  const shots = [6 + m.aGoals * 2, 6 + m.bGoals * 2];
  const sot = [Math.max(m.aGoals, 1) + 1, Math.max(m.bGoals, 1) + 1];
  const Row = ({ label, a, b }) => (
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 32px", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span className="mono" style={{ textAlign: "left", fontWeight: 700 }}>{a}</span>
      <span style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em" }}>{label}</span>
      <span className="mono" style={{ textAlign: "right", fontWeight: 700 }}>{b}</span>
    </div>
  );
  return (
    <div style={{ background: "linear-gradient(160deg,#0c1622,#0a0f17)", border: "1px solid var(--line)", borderRadius: 14, padding: compact ? "12px 14px" : "16px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 50% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%)" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 9.5, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700 }}>Full time · stats</span>
          <Icon name="photo" size={14} style={{ color: "var(--text-dim)" }} />
        </div>
        {/* possession bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
            <span className="mono" style={{ fontWeight: 700 }}>{poss}%</span>
            <span style={{ color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em" }}>Possession</span>
            <span className="mono" style={{ fontWeight: 700 }}>{100 - poss}%</span>
          </div>
          <div style={{ display: "flex", height: 6, borderRadius: 4, overflow: "hidden", gap: 2 }}>
            <div style={{ width: poss + "%", background: "var(--accent)" }} />
            <div style={{ flex: 1, background: "var(--surface-2)" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="Shots" a={shots[0]} b={shots[1]} />
          <Row label="On target" a={sot[0]} b={sot[1]} />
          <Row label="Goals" a={m.aGoals} b={m.bGoals} />
        </div>
      </div>
    </div>
  );
};

/* ============================= PLAYER PROFILE ============================= */
function PlayerScreen({ nav, params }) {
  const O = window.OFC, F = O.fns;
  const id = params.id;
  const p = O.byId[id];
  const rec = F.record(id);
  const st = F.streaks(id);
  const big = F.biggestWin(id);
  const form = F.formChips(id, 5);
  const hist = O.history[id];
  const rows = F.standings(O.activeSeason.id);
  const rank = (rows.find((r) => r.id === id) || {}).rank;
  const isYou = id === O.you.id;

  // h2h vs everyone
  const opps = O.players.filter((o) => o.id !== id).map((o) => {
    const h = F.h2h(id, o.id);
    return { o, h, games: h.aWins + h.bWins + h.draws };
  }).filter((x) => x.games > 0).sort((a, b) => b.games - a.games);

  return (
    <div className="screen-pad">
      <ScreenHeader title={isYou ? "Your profile" : p.name} sub={"@" + p.handle + " · #" + p.jersey}
        onBack={nav.canPop ? () => nav.pop() : null} right={isYou ? <button className="ofc-iconbtn" onClick={() => nav.push("setup", { edit: true })}><Icon name="edit" size={18} /></button> : null} />

      {/* identity + big ELO */}
      <div className="profile-hero">
        <Avatar player={p} size={64} ring jersey />
        <div style={{ flex: 1 }}>
          <div className="kicker">Current ELO</div>
          <div className="mono" style={{ fontSize: 46, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-.03em", color: "var(--accent)" }}>{O.ratings[id]}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Rank #{rank} · {O.activeSeason.name}</span>
          </div>
        </div>
      </div>

      {/* ELO chart */}
      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span className="kicker">ELO over time</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{hist.length - 1} games</span>
        </div>
        <LineChart data={hist} />
      </div>

      {/* stat grid */}
      <div className="stat-grid">
        <StatCard label="Record" value={`${rec.w}-${rec.d}-${rec.l}`} sub={`${rec.games} games`} />
        <StatCard label="Win rate" value={rec.winRate + "%"} accent sub={`${rec.gf} for · ${rec.ga} against`} />
        <StatCard label="Current" value={st.current} sub={st.currentType === "W" ? "win streak" : st.currentType === "L" ? "losses in a row" : "drawn run"} accent={st.currentType === "W"} />
        <StatCard label="Best streak" value={st.longestWin} sub={`${st.longestUnbeaten} unbeaten`} />
      </div>

      {/* form + biggest win */}
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Last 5</div>
          <FormChips results={form} size={24} />
        </div>
        {big && (
          <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 14 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>Biggest win</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{big.gf}–{big.ga}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>vs {O.byId[big.oppId].name.split(" ")[0]}</div>
          </div>
        )}
      </div>

      {/* h2h summary */}
      <div style={{ marginTop: 18 }}>
        <SectionLabel>Head-to-head record</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {opps.map(({ o, h, games }) => {
            const winning = h.aWins > h.bWins, losing = h.aWins < h.bWins;
            return (
              <button key={o.id} className="ofc-row h2h-row" onClick={() => nav.push("h2h", { a: id, b: o.id })}>
                <Avatar player={o} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{o.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{games} meetings</div>
                </div>
                {losing && games >= 3 && <span className="nemesis-tag">NEMESIS</span>}
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em" }}>
                  <span style={{ color: winning ? "var(--win)" : losing ? "var(--loss)" : "var(--text)" }}>{h.aWins}</span>
                  <span style={{ color: "var(--text-faint)" }}>–</span>
                  <span style={{ color: "var(--text-dim)" }}>{h.bWins}</span>
                </div>
                <Icon name="chevron" size={16} style={{ color: "var(--text-faint)" }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================= MATCH DETAIL ============================= */
function MatchScreen({ nav, params }) {
  const O = window.OFC;
  const m = O.matches.find((x) => x.id === params.id) || O.matches[0];
  const A = O.byId[m.aId], B = O.byId[m.bId];
  const season = O.seasons.find((s) => s.id === m.seasonId);
  const TeamLine = ({ p, team, goals, delta, win }) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <Avatar player={p} size={56} ring={win} jersey />
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>{p.name.split(" ")[0]}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 2 }}>
        <Icon name="jersey" size={11} />{team}
      </div>
      <div style={{ marginTop: 6 }}><EloDelta delta={delta} size={13} /></div>
    </div>
  );
  return (
    <div className="screen-pad">
      <ScreenHeader title="Match detail" sub={`${fmtDate(m.date)} · ${season ? season.name : ""}`} onBack={() => nav.pop()} />
      <div className="match-hero">
        <TeamLine p={A} team={m.aTeam} goals={m.aGoals} delta={m.aDelta} win={m.aGoals > m.bGoals} />
        <div style={{ textAlign: "center", padding: "0 4px" }}>
          <div className="mono" style={{ fontSize: 52, fontWeight: 800, lineHeight: 0.9, letterSpacing: "-.03em" }}>
            {m.aGoals}<span style={{ color: "var(--text-faint)", margin: "0 4px" }}>:</span>{m.bGoals}
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--text-dim)", marginTop: 6, fontWeight: 700 }}>Full time</div>
        </div>
        <TeamLine p={B} team={m.bTeam} goals={m.bGoals} delta={m.bDelta} win={m.bGoals > m.aGoals} />
      </div>

      {/* ELO change */}
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard label={A.name.split(" ")[0] + " ELO"} value={m.aEloAfter} sub={`${m.aEloBefore} → ${m.aEloAfter}`} accent={m.aDelta >= 0} />
        <StatCard label={B.name.split(" ")[0] + " ELO"} value={m.bEloAfter} sub={`${m.bEloBefore} → ${m.bEloAfter}`} accent={m.bDelta >= 0} />
      </div>

      <div style={{ marginTop: 18 }}>
        <SectionLabel>Stats screen</SectionLabel>
        <StatsShot m={m} />
      </div>
    </div>
  );
}

/* ============================= HEAD-TO-HEAD DETAIL ============================= */
function H2HScreen({ nav, params }) {
  const O = window.OFC, F = O.fns;
  const [a, setA] = useState(params.a || O.you.id);
  const [b, setB] = useState(params.b || O.players.find((p) => p.id !== (params.a || O.you.id)).id);
  const A = O.byId[a], B = O.byId[b];
  const h = F.h2h(a, b);
  const total = h.aWins + h.bWins + h.draws;
  const aDom = h.aWins > h.bWins, bDom = h.bWins > h.aWins;

  const Picker = ({ value, onChange, exclude }) => (
    <div className="chip-scroll" style={{ margin: 0 }}>
      {O.players.filter((p) => p.id !== exclude).map((p) => (
        <button key={p.id} onClick={() => onChange(p.id)} className={"pick-chip" + (value === p.id ? " active" : "")}>
          <Avatar player={p} size={22} /> {p.name.split(" ")[0]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="screen-pad">
      <ScreenHeader title="Head-to-head" onBack={() => nav.pop()} />

      {/* versus banner */}
      <div className="vs-banner">
        <div style={{ textAlign: "center", flex: 1 }}>
          <Avatar player={A} size={56} ring={aDom} jersey />
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{A.name.split(" ")[0]}</div>
          {aDom && total >= 3 && <span className="nemesis-tag" style={{ marginTop: 4 }}>NEMESIS</span>}
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1 }}>
            <span style={{ color: aDom ? "var(--accent)" : "var(--text)" }}>{h.aWins}</span>
            <span style={{ color: "var(--text-faint)", margin: "0 6px" }}>–</span>
            <span style={{ color: bDom ? "var(--accent)" : "var(--text)" }}>{h.bWins}</span>
          </div>
          <div style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, marginTop: 4 }}>
            {h.draws} drawn · {total} played
          </div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <Avatar player={B} size={56} ring={bDom} jersey />
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{B.name.split(" ")[0]}</div>
          {bDom && total >= 3 && <span className="nemesis-tag" style={{ marginTop: 4 }}>NEMESIS</span>}
        </div>
      </div>

      {/* pickers */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <Picker value={a} onChange={setA} exclude={b} />
        <Picker value={b} onChange={setB} exclude={a} />
      </div>

      {/* goals */}
      <div className="stat-grid" style={{ marginTop: 14 }}>
        <StatCard label="Goals for" value={h.aGF} sub={`${A.name.split(" ")[0]}`} accent />
        <StatCard label="Goals against" value={h.aGA} sub={`${B.name.split(" ")[0]}`} />
      </div>

      {/* recent meetings */}
      <div style={{ marginTop: 18 }}>
        <SectionLabel>Recent meetings</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {h.meetings.length === 0 && <div className="empty">No meetings yet — get them on the sticks.</div>}
          {h.meetings.slice(0, 8).map((mt) => (
            <button key={mt.id} className="ofc-row meeting-row" onClick={() => nav.push("match", { id: mt.id })}>
              <span className={"res-dot res-" + mt.res}>{mt.res}</span>
              <span style={{ fontSize: 12, color: "var(--text-dim)", width: 52 }}>{fmtDate(mt.date)}</span>
              <span className="mono" style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 800 }}>{mt.gf}<span style={{ color: "var(--text-faint)" }}>:</span>{mt.ga}</span>
              <EloDelta delta={mt.delta} size={12} />
              <Icon name="chevron" size={15} style={{ color: "var(--text-faint)" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================= SEASON ARCHIVE ============================= */
function ArchiveScreen({ nav, params }) {
  const O = window.OFC;
  const s = O.seasons.find((x) => x.id === params.id);
  const rows = O.archives[params.id];
  return (
    <div className="screen-pad">
      <ScreenHeader title={s.name} sub={`${s.year} · final standings`} onBack={() => nav.pop()} />
      <div className="archive-champ">
        <Icon name="crown" size={20} style={{ color: "#ffd24a" }} />
        <Avatar player={O.byId[s.championId]} size={40} jersey />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".12em", color: "#ffd24a", fontWeight: 700 }}>Champion</div>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: "var(--font-head)" }}>{O.byId[s.championId].name}</div>
        </div>
        <Icon name="trophy" size={30} style={{ color: "#ffd24a" }} />
      </div>
      <div className="table-head"><span style={{ width: 26 }}>#</span><span style={{ flex: 1 }}>Player</span><span>W-D-L</span><span style={{ width: 52, textAlign: "right" }}>ELO</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <div key={r.id} className="ofc-row board-row" style={{ cursor: "default" }}>
            <RankBadge rank={r.rank} />
            <Avatar player={O.byId[r.id]} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{O.byId[r.id].name}</span>
              {r.id === O.you.id && <span className="tag-you" style={{ marginLeft: 6 }}>YOU</span>}
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.w}-{r.d}-{r.l}</span>
            <span className="mono" style={{ width: 52, textAlign: "right", fontSize: 17, fontWeight: 800 }}>{r.elo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { StatsShot, PlayerScreen, MatchScreen, H2HScreen, ArchiveScreen });
