/* Regenerate the synthetic EA SPORTS FC 27-style Summary-tab fixture from an SVG.
   Run: node eval/sample/generate-fc27.mjs  (uses sharp — the functions package already has it)
   Layout follows the real FC 24+ full-time Summary tab: a centre table (home values left, away
   right) with NO Shots on Target row, plus circular side panels whose Shot Accuracy % is the
   only route to shots on target. Values are transcribed from a real full-time screen. The
   committed PNG is the source of truth for the eval; this just reproduces it. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "images", "fc27-summary-sample-01.png");

const rows = [
  ["52", "Possession %", "48"],
  ["4", "Ball Recovery Time (Seconds)", "6"],
  ["11", "Shots", "12"],
  ["1.78", "Expected Goals", "2.40"],
  ["80", "Passes", "80"],
  ["30", "Tackles", "56"],
  ["14", "Tackles Won", "9"],
  ["12", "Interceptions", "11"],
  ["8", "Saves", "6"],
  ["0", "Fouls Committed", "0"],
  ["0", "Offsides", "0"],
  ["5", "Corners", "4"],
  ["0", "Free Kicks", "1"],
  ["0", "Penalty Kicks", "0"],
  ["0", "Yellow Cards", "0"],
];

const panel = (cx, cy, pct, label) => `
  <circle cx="${cx}" cy="${cy}" r="66" fill="rgba(4,20,30,.55)" stroke="rgba(255,255,255,.18)" stroke-width="6"/>
  <circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="#2bf0a0" stroke-width="6"
    stroke-dasharray="${(414.7 * pct) / 100} 414.7" transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy + 14}" font-size="40" font-weight="800" fill="#ffffff" text-anchor="middle">${pct}%</text>
  <text x="${cx}" y="${cy + 108}" font-size="21" font-weight="800" fill="#ffffff" text-anchor="middle">${label}</text>`;

const table = rows
  .map(([a, label, b], i) => {
    const y = 236 + i * 41;
    return `
  <text x="560" y="${y}" font-size="23" font-weight="700" fill="#ffffff">${a}</text>
  <text x="800" y="${y}" font-size="21" font-weight="700" fill="#ffffff" text-anchor="middle">${label}</text>
  <text x="1040" y="${y}" font-size="23" font-weight="700" fill="#ffffff" text-anchor="end">${b}</text>
  <line x1="550" y1="${y + 14}" x2="1050" y2="${y + 14}" stroke="rgba(255,255,255,.12)"/>`;
  })
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" font-family="Arial, Helvetica, sans-serif">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2a5a73"/><stop offset=".55" stop-color="#173a4f"/><stop offset="1" stop-color="#0b2232"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect x="520" y="200" width="560" height="640" fill="rgba(3,14,22,.45)"/>

  <text x="560" y="78" font-size="30" font-weight="800" fill="#ffffff" text-anchor="end">MANCHESTER CITY</text>
  <text x="740" y="86" font-size="58" font-weight="800" fill="#ffffff" text-anchor="middle">3</text>
  <text x="800" y="80" font-size="34" font-weight="800" fill="#cfe6f2" text-anchor="middle">:</text>
  <text x="860" y="86" font-size="58" font-weight="800" fill="#ffffff" text-anchor="middle">1</text>
  <text x="1040" y="78" font-size="30" font-weight="800" fill="#ffffff">ARSENAL</text>
  <text x="800" y="122" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">93:33</text>

  <text x="560" y="172" font-size="23" font-weight="800" fill="#ffffff">Summary</text>
  <text x="690" y="172" font-size="21" fill="#cfe6f2">Possession</text>
  <text x="820" y="172" font-size="21" fill="#cfe6f2">Shooting</text>
  <text x="930" y="172" font-size="21" fill="#cfe6f2">Passing</text>
  <text x="1030" y="172" font-size="21" fill="#cfe6f2">Defending</text>
  <text x="1150" y="172" font-size="21" fill="#cfe6f2">Events</text>
  ${table}

  ${panel(250, 250, 83, "DRIBBLE SUCCESS RATE")}
  ${panel(250, 520, 82, "SHOT ACCURACY")}
  ${panel(250, 790 - 40, 78, "PASS ACCURACY")}
  ${panel(1350, 250, 81, "DRIBBLE SUCCESS RATE")}
  ${panel(1350, 520, 83, "SHOT ACCURACY")}
  ${panel(1350, 790 - 40, 80, "PASS ACCURACY")}
</svg>`;

// sharp isn't a root dependency; borrow the functions package's copy (or a root one if added).
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = createRequire(join(root, "functions", "package.json"))("sharp");
}
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
