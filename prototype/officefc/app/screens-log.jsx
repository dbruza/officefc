/* OfficeFC — Log-a-match flow + profile setup. */

/* ELO preview using same formula as the engine */
function eloPreview(myId, oppId, myGoals, oppGoals) {
  const O = window.OFC, K = 32;
  const Ra = O.ratings[myId], Rb = O.ratings[oppId];
  const exp = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  const S = myGoals > oppGoals ? 1 : myGoals < oppGoals ? 0 : 0.5;
  const d = Math.round(K * (S - exp));
  return d;
}

/* ============================= LOG A MATCH ============================= */
function LogMatchScreen({ nav }) {
  const O = window.OFC;
  const me = O.you;
  const [step, setStep] = useState(0);
  const [oppId, setOppId] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [oppTeam, setOppTeam] = useState(null);
  const [myGoals, setMyGoals] = useState(null);
  const [oppGoals, setOppGoals] = useState(null);
  const [photo, setPhoto] = useState(false);
  const [done, setDone] = useState(false);

  const steps = ["Opponent", "Teams", "Score", "Photo", "Review"];
  const opp = oppId ? O.byId[oppId] : null;
  const canNext = [
    !!oppId,
    !!myTeam && !!oppTeam,
    myGoals !== null && oppGoals !== null,
    true, // photo optional
    true,
  ][step];

  const myDelta = (myGoals !== null && oppGoals !== null && opp) ? eloPreview(me.id, oppId, myGoals, oppGoals) : 0;
  const oppDelta = (myGoals !== null && oppGoals !== null && opp) ? eloPreview(oppId, me.id, oppGoals, myGoals) : 0;

  function next() { if (step < 4) setStep(step + 1); else setDone(true); }
  function back() { if (step === 0) nav.pop(); else setStep(step - 1); }

  if (done) {
    const res = myGoals > oppGoals ? "win" : myGoals < oppGoals ? "loss" : "draw";
    return (
      <div className="screen-pad" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 4 }}>
          <div className={"result-burst " + res}>
            <Icon name={res === "win" ? "trophy" : res === "draw" ? "ball" : "flame"} size={40} />
          </div>
          <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 26, marginTop: 14, letterSpacing: "-.02em" }}>
            {res === "win" ? "Logged. Bragging rights secured." : res === "draw" ? "Honours even." : "Logged. We don't talk about it."}
          </div>
          <div className="mono" style={{ fontSize: 60, fontWeight: 800, letterSpacing: "-.04em", margin: "6px 0" }}>{myGoals}<span style={{ color: "var(--text-faint)" }}>:</span>{oppGoals}</div>
          <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 4 }}>
            <div><div className="kicker">You</div><div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{O.ratings[me.id] + myDelta} <EloDelta delta={myDelta} /></div></div>
            <div><div className="kicker">{opp.name.split(" ")[0]}</div><div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{O.ratings[oppId] + oppDelta} <EloDelta delta={oppDelta} /></div></div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
          <Button full size="lg" onClick={() => nav.tab("home")}>Back to dashboard</Button>
          <Button full variant="ghost" onClick={() => nav.tab("board")}>See the table</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-pad" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* stepper header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 8px" }}>
        <button onClick={back} className="ofc-iconbtn"><Icon name={step === 0 ? "x" : "back"} size={20} stroke={2.4} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 18 }}>Log a match</div>
          <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>Step {step + 1} of 5 · {steps[step]}</div>
        </div>
      </div>
      <div className="step-track">{steps.map((s, i) => <div key={i} className={"step-seg" + (i <= step ? " on" : "")} />)}</div>

      <div style={{ flex: 1, paddingTop: 16, minHeight: 0 }}>
        {/* STEP 1 — opponent */}
        {step === 0 && (
          <div>
            <div className="step-q">Who did you play?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {O.players.filter((p) => p.id !== me.id).map((p) => (
                <button key={p.id} onClick={() => setOppId(p.id)} className={"opp-pick" + (oppId === p.id ? " active" : "")}>
                  <Avatar player={p} size={40} jersey />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>ELO {O.ratings[p.id]} · @{p.handle}</div>
                  </div>
                  {oppId === p.id && <span className="check-circle"><Icon name="check" size={14} stroke={3} /></span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2 — teams */}
        {step === 1 && (
          <div>
            <div className="step-q">Which teams did you use?</div>
            <TeamSelect label="Your team" me={me} value={myTeam} onChange={setMyTeam} />
            <div style={{ height: 12 }} />
            <TeamSelect label={opp.name.split(" ")[0] + "’s team"} me={opp} value={oppTeam} onChange={setOppTeam} />
          </div>
        )}

        {/* STEP 3 — score */}
        {step === 2 && (
          <div>
            <div className="step-q">Final score</div>
            <div className="score-entry">
              <Stepper player={me} team={myTeam} value={myGoals} onChange={setMyGoals} />
              <div className="mono" style={{ fontSize: 28, color: "var(--text-faint)", fontWeight: 800 }}>:</div>
              <Stepper player={opp} team={oppTeam} value={oppGoals} onChange={setOppGoals} />
            </div>
            {myGoals !== null && oppGoals !== null && (
              <div className="elo-preview-mini">
                <Icon name="bolt" size={14} style={{ color: "var(--accent)" }} />
                <span>ELO swing preview</span>
                <span className="mono" style={{ marginLeft: "auto", fontWeight: 800 }}><EloDelta delta={myDelta} /></span>
              </div>
            )}
          </div>
        )}

        {/* STEP 4 — photo */}
        {step === 3 && (
          <div>
            <div className="step-q">Snap the stats screen</div>
            <div className="step-hint">Proof for the doubters. Optional, but recommended.</div>
            {!photo ? (
              <button className="photo-drop" onClick={() => setPhoto(true)}>
                <Icon name="camera" size={32} stroke={1.8} />
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10 }}>Take or upload a photo</div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>Tap to attach the end-of-match stats</div>
              </button>
            ) : (
              <div>
                <div style={{ position: "relative" }}>
                  <StatsShot m={{ aGoals: myGoals, bGoals: oppGoals }} />
                  <button className="photo-remove" onClick={() => setPhoto(false)}><Icon name="x" size={14} stroke={2.6} /></button>
                </div>
                <div className="attached-note"><Icon name="check" size={14} stroke={3} /> Stats photo attached</div>
              </div>
            )}
            <button className="skip-link" onClick={() => { setPhoto(false); next(); }}>Skip for now →</button>
          </div>
        )}

        {/* STEP 5 — review */}
        {step === 4 && (
          <div>
            <div className="step-q">Look right?</div>
            <div className="review-card">
              <div className="match-hero" style={{ background: "transparent", border: "none", padding: "4px 0 10px" }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <Avatar player={me} size={48} jersey ring={myGoals > oppGoals} />
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>You</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{myTeam}</div>
                </div>
                <div className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.03em" }}>{myGoals}<span style={{ color: "var(--text-faint)" }}>:</span>{oppGoals}</div>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <Avatar player={opp} size={48} jersey ring={oppGoals > myGoals} />
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{opp.name.split(" ")[0]}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{oppTeam}</div>
                </div>
              </div>
              <div className="review-divider" />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="kicker">ELO change preview</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>{photo ? "Stats photo attached" : "No photo attached"}</div>
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <div style={{ textAlign: "right" }}><div className="kicker">You</div><div className="mono" style={{ fontSize: 18, fontWeight: 800 }}><EloDelta delta={myDelta} /></div></div>
                  <div style={{ textAlign: "right" }}><div className="kicker">{opp.name.split(" ")[0]}</div><div className="mono" style={{ fontSize: 18, fontWeight: 800 }}><EloDelta delta={oppDelta} /></div></div>
                </div>
              </div>
            </div>
            <div className="step-hint" style={{ textAlign: "center", marginTop: 14 }}>Both players can dispute within 24h.</div>
          </div>
        )}
      </div>

      {/* footer cta */}
      <div style={{ paddingTop: 12, paddingBottom: 6 }}>
        <Button full size="lg" onClick={next} icon={step === 4 ? "check" : undefined}
          style={{ opacity: canNext ? 1 : 0.4, pointerEvents: canNext ? "auto" : "none" }}>
          {step === 4 ? "Submit match" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

/* searchable team select */
function TeamSelect({ label, me, value, onChange }) {
  const O = window.OFC;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = O.teams.filter((t) => t.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="field-label"><Avatar player={me} size={18} /> {label}</div>
      <button className={"team-field" + (value ? " filled" : "")} onClick={() => setOpen(!open)}>
        <Icon name="jersey" size={16} style={{ color: value ? me.color : "var(--text-dim)" }} />
        <span style={{ flex: 1, textAlign: "left", color: value ? "var(--text)" : "var(--text-dim)" }}>{value || "Search teams…"}</span>
        <Icon name={open ? "chevron" : "search"} size={16} style={{ color: "var(--text-dim)", transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      {open && (
        <div className="team-pop">
          <div className="search-box" style={{ margin: "0 0 8px" }}>
            <Icon name="search" size={15} stroke={2.2} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a team name" />
          </div>
          <div className="team-list">
            {list.map((t) => (
              <button key={t} className={"team-opt" + (value === t ? " active" : "")} onClick={() => { onChange(t); setOpen(false); setQ(""); }}>
                <Icon name="jersey" size={14} style={{ color: "var(--text-dim)" }} /> {t}
                {value === t && <Icon name="check" size={14} stroke={3} style={{ marginLeft: "auto", color: "var(--accent)" }} />}
              </button>
            ))}
            {list.length === 0 && <div className="empty" style={{ padding: 12 }}>No teams match “{q}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* score stepper */
function Stepper({ player, team, value, onChange }) {
  const v = value === null ? 0 : value;
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <Avatar player={player} size={40} jersey />
      <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "6px 0 8px", height: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team || "—"}</div>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(0, v - 1))} disabled={v === 0}>−</button>
        <span className="mono" style={{ fontSize: 36, fontWeight: 800, minWidth: 40 }}>{value === null ? "–" : value}</span>
        <button onClick={() => onChange(v + 1)}>+</button>
      </div>
    </div>
  );
}

/* ============================= PROFILE SETUP ============================= */
function SetupScreen({ nav, params }) {
  const O = window.OFC;
  const editing = params && params.edit;
  const me = O.you;
  const [name, setName] = useState(editing ? me.name : "");
  const [handle, setHandle] = useState(editing ? me.handle : "");
  const [jersey, setJersey] = useState(editing ? String(me.jersey) : "");
  const [color, setColor] = useState(editing ? me.color : "#00ff87");
  const palette = ["#00ff87", "#ff5470", "#5b9dff", "#ffb020", "#c06bff", "#36e0c8", "#ff8a3d", "#9aa7ff"];
  const initials = (name.trim() || "??").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const preview = { initials, color, jersey: jersey || "—" };

  return (
    <div className="screen-pad" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <ScreenHeader title={editing ? "Edit profile" : "Create your player"} sub={editing ? "" : "Shared console — keep it quick"} onBack={editing ? () => nav.pop() : null} />

      {/* avatar preview */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "10px 0 22px" }}>
        <Avatar player={preview} size={88} ring jersey />
        <div className="palette-row">
          {palette.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={"swatch" + (color === c ? " active" : "")} style={{ background: c }} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
        <Field label="Display name" required>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marcus Bell" maxLength={20} />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Handle" optional style={{ flex: 2 }}>
            <div className="text-input prefix"><span style={{ color: "var(--text-dim)" }}>@</span><input value={handle} onChange={(e) => setHandle(e.target.value.replace(/\s/g, ""))} placeholder="handle" maxLength={14} /></div>
          </Field>
          <Field label="Jersey #" optional style={{ flex: 1 }}>
            <input className="text-input mono" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="10" inputMode="numeric" />
          </Field>
        </div>
      </div>

      <div style={{ paddingTop: 16, paddingBottom: 6 }}>
        <Button full size="lg" icon={editing ? "check" : "ball"} onClick={() => nav.tab("home")}
          style={{ opacity: name.trim() ? 1 : 0.4, pointerEvents: name.trim() ? "auto" : "none" }}>
          {editing ? "Save changes" : "Enter the league"}
        </Button>
      </div>
    </div>
  );
}

const Field = ({ label, required, optional, children, style }) => (
  <label style={{ display: "block", ...style }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
      <span style={{ fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700 }}>{label}</span>
      {optional && <span style={{ fontSize: 10, color: "var(--text-faint)" }}>optional</span>}
      {required && <span style={{ fontSize: 10, color: "var(--accent)" }}>●</span>}
    </div>
    {children}
  </label>
);

Object.assign(window, { LogMatchScreen, SetupScreen, TeamSelect, Stepper, Field, eloPreview });
