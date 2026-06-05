/* OfficeFC — app shell: navigation, phone frame, tab bar.
   Self-contained build: the prototype's host-protocol "tweaks panel" scaffolding
   is intentionally dropped; design defaults (electric-green accent, Archivo display
   font, cheeky copy) are baked into the CSS / this constant. */

const CHEEKY = true;

function StatusBar() {
  return (
    <div className="status-bar">
      <span className="mono" style={{ fontWeight: 700 }}>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="6" width="3" height="5" rx="1"/><rect x="4.5" y="4" width="3" height="7" rx="1"/><rect x="9" y="2" width="3" height="9" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M8 2.5c2 0 3.8.8 5 2l1.2-1.3C13.6 1.6 11 .5 8 .5S2.4 1.6.8 3.2L2 4.5c1.2-1.2 3-2 6-2Z"/><path d="M8 5.5c1.1 0 2.1.4 2.8 1.1L8 9.5 5.2 6.6C5.9 5.9 6.9 5.5 8 5.5Z"/></svg>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <div style={{ width: 22, height: 11, border: "1.5px solid currentColor", borderRadius: 3, padding: 1.5, opacity: 0.9 }}>
            <div style={{ width: "78%", height: "100%", background: "currentColor", borderRadius: 1 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "home", icon: "home", label: "Home" },
  { id: "board", icon: "board", label: "Table" },
  { id: "seasons", icon: "seasons", label: "Seasons" },
  { id: "profile", icon: "profile", label: "You" },
];

function TabBar({ active, onTab, onLog }) {
  return (
    <div className="tab-bar">
      {TABS.slice(0, 2).map((t) => <TabBtn key={t.id} t={t} active={active === t.id} onClick={() => onTab(t.id)} />)}
      <button className="fab" onClick={onLog} aria-label="Log a match"><Icon name="plus" size={26} stroke={2.8} /></button>
      {TABS.slice(2).map((t) => <TabBtn key={t.id} t={t} active={active === t.id} onClick={() => onTab(t.id)} />)}
    </div>
  );
}
const TabBtn = ({ t, active, onClick }) => (
  <button className={"tab-btn" + (active ? " active" : "")} onClick={onClick}>
    <Icon name={t.icon} size={22} stroke={active ? 2.4 : 2} />
    <span>{t.label}</span>
  </button>
);

function App() {
  const [stack, setStack] = useState([{ screen: "home" }]);
  const scrollRef = useRef(null);

  const nav = useMemo(() => ({
    push: (screen, params) => setStack((s) => [...s, { screen, params: params || {} }]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    tab: (screen) => setStack([{ screen }]),
    get canPop() { return stack.length > 1; },
  }), [stack.length]);

  // scroll to top on navigation
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [stack.length, stack[stack.length - 1].screen]);

  // responsive scale to fit the phone frame in any viewport
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const vh = window.innerHeight, vw = window.innerWidth;
      setScale(Math.min(1, (vh - 36) / 844, (vw - 24) / 390));
    };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  const top = stack[stack.length - 1];
  const rootTab = stack[0].screen;
  const activeTab = ["home", "board", "seasons", "profile"].includes(rootTab) ? rootTab : null;
  const hideChrome = top.screen === "log" || top.screen === "setup";

  function renderScreen() {
    const p = top.params || {};
    switch (top.screen) {
      case "home": return <HomeScreen nav={nav} cheeky={CHEEKY} />;
      case "board": return <LeaderboardScreen nav={nav} />;
      case "seasons": return <SeasonsScreen nav={nav} />;
      case "profile": return <PlayerScreen nav={{ ...nav, canPop: false }} params={{ id: window.OFC.you.id }} />;
      case "player": return <PlayerScreen nav={{ ...nav, canPop: true }} params={p} />;
      case "match": return <MatchScreen nav={nav} params={p} />;
      case "h2h": return <H2HScreen nav={nav} params={p} />;
      case "archive": return <ArchiveScreen nav={nav} params={p} />;
      case "log": return <LogMatchScreen nav={nav} />;
      case "setup": return <SetupScreen nav={nav} params={p} />;
      default: return <HomeScreen nav={nav} cheeky={CHEEKY} />;
    }
  }

  return (
    <div className="stage">
      <div className="phone-scaler" style={{ transform: `scale(${scale})` }}>
        <div className="phone" id="ofc-root">
          <StatusBar />
          <div className="phone-scroll" ref={scrollRef} data-screen-label={top.screen}>
            {renderScreen()}
          </div>
          {!hideChrome && <TabBar active={activeTab} onTab={(id) => nav.tab(id)} onLog={() => nav.push("log")} />}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
