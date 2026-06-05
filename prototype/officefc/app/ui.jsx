/* OfficeFC — shared UI atoms. Exported to window for cross-file use. */
const { useState, useEffect, useRef, useMemo } = React;

/* ---------------- generic football iconography (no branding) ---------------- */
const Icon = ({ name, size = 20, stroke = 2, style }) => {
  const c = { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style };
  const P = {
    home: <path d="M3 11.5 12 4l9 7.5M5 10v9h14v-9" />,
    board: <><path d="M4 19V7M10 19V4M16 19v-8M22 19H2" /></>,
    seasons: <><circle cx="12" cy="9" r="5" /><path d="M8 13.5 6.5 21l5.5-3 5.5 3-1.5-7.5" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    back: <path d="M15 5l-7 7 7 7" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    up: <path d="M12 19V5M6 11l6-6 6 6" />,
    down: <path d="M12 5v14M18 13l-6 6-6-6" />,
    camera: <><path d="M3 8h3l1.5-2h9L18 8h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></>,
    flame: <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c2 2 3 3 3 6a5 5 0 0 1-10 0c0-4 5-6 5-13Z" />,
    trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 19h6M10 15.5V19M14 15.5V19" /></>,
    crown: <path d="M4 8l3 8h10l3-8-4.5 3.5L12 5 8.5 11.5 4 8Z" />,
    medal: <><circle cx="12" cy="14" r="5" /><path d="M9 9 7 3h10l-2 6" /></>,
    swords: <><path d="M4 4h3l9 9-3 3-9-9V4Z" /><path d="m14 14 6 6M20 4h-3l-4 4M15 9l5 5" /></>,
    ball: <><circle cx="12" cy="12" r="9" /><path d="m12 7 3 2.2-1.1 3.6h-3.8L9 9.2 12 7Z" /></>,
    jersey: <path d="M8 4 4 7l1.5 3L8 9v11h8V9l2.5 1L20 7l-4-3-2 1.5h-4L8 4Z" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
    check: <path d="M5 12.5 10 17 19 7" />,
    photo: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-4 4 3 3-2 4 3" /></>,
    edit: <path d="M4 20h4L18 10l-4-4L4 16v4ZM13 7l4 4" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return <svg {...c}>{P[name] || null}</svg>;
};

/* ---------------- avatar ---------------- */
const Avatar = ({ player, size = 40, ring = false, jersey = false }) => {
  if (!player) return null;
  const fs = Math.round(size * 0.38);
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: `linear-gradient(150deg, ${player.color}, ${shade(player.color, -28)})`,
        display: "grid", placeItems: "center", color: "#06080c", fontWeight: 800,
        fontFamily: "var(--font-head)", fontSize: fs, letterSpacing: "-.02em",
        boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px ${player.color}` : "none",
      }}>{player.initials}</div>
      {jersey && (
        <div className="mono" style={{
          position: "absolute", bottom: -3, right: -3, minWidth: 16, height: 16, padding: "0 3px",
          borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--line)",
          color: "var(--text-dim)", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center",
        }}>{player.jersey}</div>
      )}
    </div>
  );
};

/* ---------------- form chips (W/D/L) ---------------- */
const resColor = { W: "var(--win)", D: "var(--draw)", L: "var(--loss)" };
const FormChips = ({ results = [], size = 22, gap = 4 }) => (
  <div style={{ display: "flex", gap }}>
    {results.length === 0 && <span style={{ color: "var(--text-faint)", fontSize: 12 }}>No games yet</span>}
    {results.map((r, i) => (
      <div key={i} className="mono" style={{
        width: size, height: size, borderRadius: 6, display: "grid", placeItems: "center",
        fontSize: Math.round(size * 0.5), fontWeight: 800, color: r === "D" ? "#0a0c10" : "#06080c",
        background: resColor[r], opacity: 0.45 + (i + 1) / (results.length * 1.8),
      }}>{r}</div>
    ))}
  </div>
);

/* ---------------- ELO delta pill ---------------- */
const EloDelta = ({ delta, size = 13 }) => {
  const pos = delta >= 0;
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 2, fontSize: size, fontWeight: 700,
      color: pos ? "var(--win)" : "var(--loss)",
    }}>{pos ? "▲" : "▼"}{pos ? "+" : ""}{delta}</span>
  );
};

/* ---------------- movement arrow ---------------- */
const Movement = ({ move }) => {
  if (!move) return <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 12 }}>—</span>;
  const up = move > 0;
  return (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 1, fontSize: 12, fontWeight: 700, color: up ? "var(--win)" : "var(--loss)" }}>
      {up ? "▲" : "▼"}{Math.abs(move)}
    </span>
  );
};

/* ---------------- stat card ---------------- */
const StatCard = ({ label, value, sub, accent, mono = true, children }) => (
  <div style={{
    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
    padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
  }}>
    <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700 }}>{label}</div>
    {value !== undefined && (
      <div className={mono ? "mono" : ""} style={{
        fontSize: 30, fontWeight: 800, lineHeight: 1.02, color: accent ? "var(--accent)" : "var(--text)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-head)", letterSpacing: "-.02em",
      }}>{value}</div>
    )}
    {sub && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{sub}</div>}
    {children}
  </div>
);

/* ---------------- button ---------------- */
const Button = ({ children, variant = "primary", icon, full, onClick, size = "md", style }) => {
  const sz = size === "lg" ? { padding: "16px 20px", fontSize: 16 } : size === "sm" ? { padding: "8px 12px", fontSize: 13 } : { padding: "12px 16px", fontSize: 14.5 };
  const variants = {
    primary: { background: "var(--accent)", color: "#06080c", border: "1px solid var(--accent)" },
    dark: { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line)" },
    ghost: { background: "transparent", color: "var(--text)", border: "1px solid var(--line)" },
    danger: { background: "transparent", color: "var(--loss)", border: "1px solid color-mix(in srgb, var(--loss) 40%, transparent)" },
  };
  return (
    <button onClick={onClick} className="ofc-btn" style={{
      ...sz, ...variants[variant], width: full ? "100%" : "auto", borderRadius: 13, fontWeight: 700,
      fontFamily: "var(--font-head)", letterSpacing: ".01em", display: "inline-flex", alignItems: "center",
      justifyContent: "center", gap: 8, cursor: "pointer", ...style,
    }}>
      {icon && <Icon name={icon} size={size === "lg" ? 20 : 17} stroke={2.4} />}
      {children}
    </button>
  );
};

/* ---------------- section label ---------------- */
const SectionLabel = ({ children, action }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "2px 2px 10px" }}>
    <div style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 800, fontFamily: "var(--font-head)" }}>{children}</div>
    {action}
  </div>
);

/* ---------------- rank badge ---------------- */
const RankBadge = ({ rank, size = 26 }) => {
  const medal = rank <= 3;
  const colors = { 1: "#ffd24a", 2: "#cdd6e0", 3: "#e0935b" };
  return (
    <div className="mono" style={{
      width: size, height: size, borderRadius: 8, display: "grid", placeItems: "center",
      fontSize: size * 0.48, fontWeight: 800,
      background: medal ? colors[rank] : "var(--surface-2)",
      color: medal ? "#06080c" : "var(--text-dim)",
      border: medal ? "none" : "1px solid var(--line)",
    }}>{rank}</div>
  );
};

/* ---------------- player row (reusable) ---------------- */
const PlayerRow = ({ player, rank, elo, move, record, form, you, onClick, compact }) => (
  <button onClick={onClick} className="ofc-row" style={{
    display: "grid", gridTemplateColumns: rank ? "auto auto 1fr auto" : "auto 1fr auto",
    alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "10px 12px",
    background: you ? "color-mix(in srgb, var(--accent) 9%, var(--surface))" : "var(--surface)",
    border: `1px solid ${you ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--line)"}`,
    borderRadius: 14, cursor: "pointer",
  }}>
    {rank && <RankBadge rank={rank} />}
    <Avatar player={player} size={38} jersey />
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{player.name}</span>
        {you && <span className="tag-you">YOU</span>}
      </div>
      {!compact && (
        <div style={{ marginTop: 4 }}>
          {form ? <FormChips results={form} size={16} gap={3} /> :
            record && <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{record.w}W {record.d}D {record.l}L</span>}
        </div>
      )}
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span className="mono" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>{elo}</span>
      {move !== undefined && <Movement move={move} />}
    </div>
  </button>
);

/* ---------------- ELO line chart (SVG) ---------------- */
const LineChart = ({ data, w = 326, h = 150, color = "var(--accent)" }) => {
  if (!data || data.length < 2) return null;
  const pad = { t: 14, r: 8, b: 16, l: 8 };
  const xs = data.map((_, i) => i);
  const ys = data.map((d) => d.rating);
  const minY = Math.min(...ys) - 12, maxY = Math.max(...ys) + 12;
  const X = (i) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d.rating).toFixed(1)}`).join(" ");
  const area = `${line} L${X(data.length - 1).toFixed(1)},${h - pad.b} L${X(0).toFixed(1)},${h - pad.b} Z`;
  const last = data[data.length - 1];
  const gridY = [minY, (minY + maxY) / 2, maxY];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="eloFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridY.map((g, i) => (
        <line key={i} x1={pad.l} x2={w - pad.r} y1={Y(g)} y2={Y(g)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      <path d={area} fill="url(#eloFill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(data.length - 1)} cy={Y(last.rating)} r="4.5" fill={color} stroke="var(--bg)" strokeWidth="2" />
    </svg>
  );
};

/* helpers */
function shade(hex, amt) {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function daysUntil(iso) {
  const end = new Date(iso + "T23:59:59").getTime();
  return Math.max(0, Math.ceil((end - new Date("2026-06-03").getTime()) / 86400000));
}

Object.assign(window, {
  Icon, Avatar, FormChips, EloDelta, Movement, StatCard, Button, SectionLabel,
  RankBadge, PlayerRow, LineChart, shade, fmtDate, daysUntil,
});
