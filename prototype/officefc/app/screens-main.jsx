/* OfficeFC — main tab screens + shared layout. */
const O = window.OFC, F = window.OFC.fns;

/* shared: pushed-screen header */
const ScreenHeader = ({ title, sub, onBack, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 14px" }}>
    {onBack && (
      <button onClick={onBack} className="ofc-iconbtn" aria-label="Back">
        <Icon name="back" size={22} stroke={2.4} />
      </button>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 20, letterSpacing: "-.02em", lineHeight: 1.05 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

/* season pill with live countdown */
const SeasonPill = ({ onClick }) => {
  const left = daysUntil(O.activeSeason.end);
  return (
    <button onClick={onClick} className="ofc-pill" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: 9, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
      <span style={{ fontWeight: 700, fontSize: 12.5 }}>{O.activeSeason.name}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>{left}d left</span>
    </button>
  );
};

/* ============================= HOME ============================= */
function HomeScreen({ nav, cheeky }) {
  const me = O.you;
  const rows = F.standings(O.activeSeason.id);
  const myRow = rows.find((r) => r.id === me.id);
  const rec = F.record(me.id);
  const form = F.formChips(me.id, 5);
  const st = F.streaks(me.id);
  const nem = F.nemesis(me.id);
  const nemId = nem ? (nem.aId === me.id ? nem.bId : nem.aId) : null;
  const top3 = rows.slice(0, 3);
  const streakLine = st.currentType === "W" ? `${st.current}-game win streak 🔥`
    : st.currentType === "L" ? `${st.current}-game skid` : `${st.current} unbeaten`;

  return (
    <div className="screen-pad">
      {/* greeting */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 2px 14px" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{cheeky ? "Back for more punishment," : "Welcome back,"}</div>
          <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 22, letterSpacing: "-.02em" }}>{me.name.split(" ")[0]}</div>
        </div>
        <SeasonPill onClick={() => nav.tab("seasons")} />
      </div>

      {/* hero rank card */}
      <div className="hero-card" onClick={() => nav.push("player", { id: me.id })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="kicker">Rank</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="mono hero-rank">#{myRow ? myRow.rank : "–"}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 13 }}>of {rows.length}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="kicker">ELO</div>
            <div className="mono hero-elo">{O.ratings[me.id]}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 16 }}>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Last 5</div>
            <FormChips results={form} size={26} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: st.currentType === "W" ? "var(--accent)" : "var(--text-dim)", fontSize: 12.5, fontWeight: 700 }}>
            {st.currentType === "W" && <Icon name="flame" size={15} />}
            <span className="mono">{streakLine}</span>
          </div>
        </div>
      </div>

      {/* log a match */}
      <button className="log-cta" onClick={() => nav.push("log")}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Icon name="plus" size={22} stroke={2.6} /> Log a match
        </span>
        <span className="mono" style={{ fontSize: 12, opacity: 0.7 }}>+ELO ↑</span>
      </button>

      {/* nemesis */}
      {nem && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel>Current nemesis</SectionLabel>
          <button className="nemesis-card" onClick={() => nav.push("h2h", { a: me.id, b: nemId })}>
            <Avatar player={O.byId[nemId]} size={48} jersey />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{O.byId[nemId].name}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{cheeky ? "owns you all-time" : "your worst matchup"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
                <span style={{ color: "var(--loss)" }}>{nem.aWins}</span>
                <span style={{ color: "var(--text-faint)" }}>–</span>
                <span style={{ color: "var(--text)" }}>{nem.bWins}</span>
              </div>
              <div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--loss)", fontWeight: 700 }}>down all-time</div>
            </div>
          </button>
        </div>
      )}

      {/* top 3 */}
      <div style={{ marginTop: 18 }}>
        <SectionLabel action={<button className="link-btn" onClick={() => nav.tab("board")}>Full table →</button>}>Top of the table</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top3.map((r) => (
            <PlayerRow key={r.id} player={O.byId[r.id]} rank={r.rank} elo={r.elo} move={r.move}
              form={r.form} you={r.id === me.id} onClick={() => nav.push("player", { id: r.id })} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================= LEADERBOARD ============================= */
function LeaderboardScreen({ nav }) {
  const [seasonId, setSeasonId] = useState(O.activeSeason.id);
  const [q, setQ] = useState("");
  const isActive = seasonId === O.activeSeason.id;
  let rows = isActive ? F.standings(seasonId)
    : O.archives[seasonId].map((r) => ({ ...r, form: null, move: undefined }));
  if (q.trim()) rows = rows.filter((r) => O.byId[r.id].name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="screen-pad">
      <ScreenHeader title="Leaderboard" sub={`${rows.length} contenders`} />
      {/* season filter */}
      <div className="chip-scroll">
        {O.seasons.map((s) => (
          <button key={s.id} onClick={() => setSeasonId(s.id)}
            className={"season-chip" + (seasonId === s.id ? " active" : "")}>
            {s.name}{s.active && <span className="live-dot" />}
          </button>
        ))}
      </div>
      {/* search */}
      <div className="search-box">
        <Icon name="search" size={16} stroke={2.2} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" />
      </div>
      {/* header row */}
      <div className="table-head">
        <span style={{ width: 26 }}>#</span><span style={{ flex: 1 }}>Player</span>
        <span>W-D-L</span><span style={{ width: 52, textAlign: "right" }}>ELO</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <button key={r.id} className="ofc-row board-row" onClick={() => nav.push("player", { id: r.id })}>
            <RankBadge rank={r.rank} />
            <Avatar player={O.byId[r.id]} size={36} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{O.byId[r.id].name}</span>
                {r.id === O.you.id && <span className="tag-you">YOU</span>}
              </div>
              {r.form ? <div style={{ marginTop: 4 }}><FormChips results={r.form} size={15} gap={3} /></div>
                : <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>champion era</span>}
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{r.w}-{r.d}-{r.l}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono" style={{ fontSize: 17, fontWeight: 800 }}>{r.elo}</span>
                {r.move !== undefined && <Movement move={r.move} />}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================= SEASONS & HALL OF FAME ============================= */
function SeasonsScreen({ nav }) {
  const left = daysUntil(O.activeSeason.end);
  const total = Math.ceil((new Date(O.activeSeason.end) - new Date(O.activeSeason.start)) / 86400000);
  const pct = Math.min(100, Math.round(((total - left) / total) * 100));
  const past = O.seasons.filter((s) => !s.active);
  const rows = F.standings(O.activeSeason.id);
  const leader = rows[0];

  return (
    <div className="screen-pad">
      <ScreenHeader title="Seasons" sub="Hall of Fame & silverware" />
      {/* current season card */}
      <div className="current-season">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="kicker" style={{ color: "var(--accent)" }}>● Live season</div>
            <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", marginTop: 2 }}>{O.activeSeason.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{fmtDate(O.activeSeason.start)} – {fmtDate(O.activeSeason.end)} · 2026</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 34, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>{left}</div>
            <div className="kicker">days left</div>
          </div>
        </div>
        <div className="progress"><div style={{ width: pct + "%" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar player={O.byId[leader.id]} size={30} />
            <div>
              <div style={{ fontSize: 10.5, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700 }}>Leading</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{O.byId[leader.id].name}</div>
            </div>
          </div>
          <Icon name="trophy" size={26} style={{ color: "var(--accent)" }} />
        </div>
      </div>

      <SectionLabel>Past seasons</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {past.map((s) => (
          <button key={s.id} className="past-season" onClick={() => nav.push("archive", { id: s.id })}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 16 }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{s.year}</div>
              </div>
              <Icon name="chevron" size={18} style={{ color: "var(--text-dim)" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <PodiumChip place="Champion" player={O.byId[s.championId]} icon="trophy" gold />
              <PodiumChip place="Runner-up" player={O.byId[s.runnerUpId]} icon="medal" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 10.5, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700, marginRight: 2 }}>POTM</span>
              {s.potm.map((p) => (
                <div key={p.m} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Avatar player={O.byId[p.playerId]} size={20} />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{p.m}</span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const PodiumChip = ({ place, player, icon, gold }) => (
  <div style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
    <Avatar player={player} size={34} />
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Icon name={icon} size={13} style={{ color: gold ? "#ffd24a" : "#cdd6e0" }} />
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-dim)", fontWeight: 700 }}>{place}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{player.name}</div>
    </div>
  </div>
);

Object.assign(window, { ScreenHeader, SeasonPill, HomeScreen, LeaderboardScreen, SeasonsScreen, PodiumChip });
