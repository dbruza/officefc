/* OfficeFC — design system showcase. Reuses the live product components. */
const O = window.OFC, F = O.fns;

const Card = ({ title, sub, children, span }) => (
  <div className="ds-card" style={span ? { gridColumn: `span ${span}` } : null}>
    {(title || sub) && (
      <div className="ds-card-head">
        {title && <span className="ds-card-title">{title}</span>}
        {sub && <span className="ds-card-sub">{sub}</span>}
      </div>
    )}
    <div className="ds-card-body">{children}</div>
  </div>
);

const Swatch = ({ name, varName, hex, dark }) => (
  <div className="ds-swatch">
    <div className="ds-swatch-chip" style={{ background: hex, border: dark ? "1px solid var(--line)" : "none" }} />
    <div>
      <div className="ds-swatch-name">{name}</div>
      <div className="mono ds-swatch-hex">{hex}</div>
      <div className="mono ds-swatch-var">{varName}</div>
    </div>
  </div>
);

const Spec = ({ children, note, style }) => (
  <div className="ds-spec">
    <div style={style}>{children}</div>
    {note && <div className="ds-spec-note">{note}</div>}
  </div>
);

function Showcase() {
  const me = O.you;
  const rows = F.standings(O.activeSeason.id);
  const colors = [
    ["Base", "--bg", "#070a0e", true], ["Surface", "--surface", "#10141b", true],
    ["Surface 2", "--surface-2", "#1a212b", true], ["Accent", "--accent", "#00ff87"],
    ["Win", "--win", "#22e06a"], ["Draw", "--draw", "#9aa6b4"], ["Loss", "--loss", "#ff4d6d"],
    ["Text", "--text", "#eef2f6"], ["Text dim", "--text-dim", "#8b95a4"], ["Text faint", "--text-faint", "#4c5563"],
  ];

  return (
    <div className="ds-page">
      {/* header */}
      <header className="ds-header">
        <div className="ds-logo">
          <span className="ds-logo-mark"><Icon name="ball" size={26} /></span>
          <div>
            <div className="ds-logo-name">Office<span style={{ color: "var(--accent)" }}>FC</span></div>
            <div className="ds-logo-tag">Design System · office bragging rights, quantified</div>
          </div>
        </div>
        <a className="ds-cta" href="OfficeFC.html">Open prototype →</a>
      </header>

      {/* COLOURS */}
      <section>
        <h2 className="ds-h2"><span className="ds-num">01</span> Colour</h2>
        <p className="ds-lead">A near-black broadcast stage with a single electric accent. Result colours are reserved and never used decoratively — green/grey/red mean win/draw/loss, always.</p>
        <div className="ds-swatch-grid">{colors.map((c) => <Swatch key={c[1]} name={c[0]} varName={c[1]} hex={c[2]} dark={c[3]} />)}</div>
      </section>

      {/* TYPE */}
      <section>
        <h2 className="ds-h2"><span className="ds-num">02</span> Typography</h2>
        <div className="ds-grid">
          <Card title="Display" sub="Archivo · 800" span={2}>
            <Spec note="Screen titles, hero labels, buttons. Tight tracking, often uppercase.">
              <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 44, letterSpacing: "-.03em", lineHeight: 1 }}>FULL TIME</div>
              <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 22, marginTop: 8 }}>Summer Showdown</div>
            </Spec>
          </Card>
          <Card title="Numerals" sub="JetBrains Mono · tabular">
            <Spec note="Every stat, score and ELO. Tabular figures keep columns aligned.">
              <div className="mono" style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-.03em", color: "var(--accent)", lineHeight: 1 }}>1522</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>3 : 1 · 2–9</div>
            </Spec>
          </Card>
          <Card title="Body & labels">
            <Spec>
              <div style={{ fontSize: 15, lineHeight: 1.5 }}>Body copy stays compact and factual.</div>
              <div className="kicker" style={{ marginTop: 12 }}>Section label</div>
            </Spec>
          </Card>
        </div>
      </section>

      {/* CORE COMPONENTS */}
      <section>
        <h2 className="ds-h2"><span className="ds-num">03</span> Components</h2>
        <div className="ds-grid">
          <Card title="Form chips" sub="Last-five result run">
            <FormChips results={["L", "W", "W", "W", "W"]} size={28} />
            <div className="ds-mini-legend">
              <span><i className="ds-dot" style={{ background: "var(--win)" }} /> Win</span>
              <span><i className="ds-dot" style={{ background: "var(--draw)" }} /> Draw</span>
              <span><i className="ds-dot" style={{ background: "var(--loss)" }} /> Loss</span>
            </div>
          </Card>

          <Card title="Avatars" sub="Initials · jersey badge">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {O.players.slice(0, 5).map((p) => <Avatar key={p.id} player={p} size={44} jersey />)}
              <Avatar player={me} size={56} ring jersey />
            </div>
          </Card>

          <Card title="Buttons" sub="4 variants · 3 sizes">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button icon="plus">Log a match</Button>
                <Button variant="dark">Dispute</Button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="ghost" size="sm">Filter</Button>
                <Button variant="danger" size="sm" icon="x">Remove</Button>
              </div>
            </div>
          </Card>

          <Card title="Rank, movement & ELO change">
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6 }}><RankBadge rank={1} /><RankBadge rank={2} /><RankBadge rank={3} /><RankBadge rank={7} /></div>
              <div style={{ display: "flex", gap: 12 }}><Movement move={2} /><Movement move={-1} /><Movement move={0} /></div>
              <div style={{ display: "flex", gap: 12 }}><EloDelta delta={14} /><EloDelta delta={-9} /></div>
            </div>
          </Card>

          <Card title="Stat cards" span={2}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <StatCard label="Win rate" value="48%" accent sub="62 for · 70 against" />
              <StatCard label="Record" value="7-0-10" sub="17 games" />
              <StatCard label="Best streak" value="4" sub="6 unbeaten" />
            </div>
          </Card>

          <Card title="Chips & tags">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="season-chip active">Summer Showdown<span className="live-dot" /></span>
                <span className="season-chip">Spring Cup</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="nemesis-tag">NEMESIS</span>
                <span className="tag-you">YOU</span>
                <span className="res-dot res-W">W</span><span className="res-dot res-D">D</span><span className="res-dot res-L">L</span>
              </div>
            </div>
          </Card>

          <Card title="Player row" sub="The workhorse list item" span={3}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.slice(0, 3).map((r) => (
                <PlayerRow key={r.id} player={O.byId[r.id]} rank={r.rank} elo={r.elo} move={r.move} form={r.form} you={r.id === me.id} />
              ))}
            </div>
          </Card>

          <Card title="ELO over time" sub="SVG line chart">
            <LineChart data={O.history[me.id]} w={320} h={140} />
          </Card>

          <Card title="Stats screen" sub="Photo stand-in">
            <StatsShot m={{ aGoals: 3, bGoals: 1 }} />
          </Card>
        </div>
      </section>

      {/* SCREENS */}
      <section>
        <h2 className="ds-h2"><span className="ds-num">04</span> Screens</h2>
        <p className="ds-lead">Eight screens, one grammar. Open the prototype to tap through the full flow.</p>
        <div className="ds-screens">
          {[["Home dashboard", "home"], ["Leaderboard", "board"], ["Log a match", "log"], ["Player profile", "player"], ["Match detail", "match"], ["Head-to-head", "h2h"], ["Seasons & Hall of Fame", "seasons"], ["Profile setup", "setup"]].map(([label, s]) => (
            <a key={s} className="ds-screen-link" href={"OfficeFC.html"}>
              <span className="ds-screen-dot" />
              <span>{label}</span>
              <Icon name="chevron" size={15} style={{ marginLeft: "auto", color: "var(--text-faint)" }} />
            </a>
          ))}
        </div>
      </section>

      <footer className="ds-footer">OfficeFC · all teams, players and crests are generic and original.</footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Showcase />);
