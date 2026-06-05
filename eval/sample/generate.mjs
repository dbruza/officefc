/* Regenerate the synthetic full-time-screen fixture from an SVG.
   Requires sharp (dev-only):  npm i -D sharp  &&  node eval/sample/generate.mjs
   The committed PNG is the source of truth for the eval; this just reproduces it.
   Replace it with REAL screenshots/photos for a meaningful accuracy number. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "images", "full-time-sample-01.png");

const row = (y, a, label, b) => `
  <text x="180" y="${y}" font-size="30" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="monospace">${a}</text>
  <text x="450" y="${y}" font-size="24" font-weight="600" fill="#cfeede" text-anchor="middle">${label}</text>
  <text x="720" y="${y}" font-size="30" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="monospace">${b}</text>
  <line x1="130" y1="${y + 24}" x2="770" y2="${y + 24}" stroke="rgba(255,255,255,.08)" />`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1280" viewBox="0 0 900 1280" font-family="system-ui, Arial, sans-serif">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0c4032"/><stop offset="1" stop-color="#06231a"/></linearGradient></defs>
  <rect width="900" height="1280" fill="url(#bg)"/>
  <text x="450" y="110" font-size="26" font-weight="700" letter-spacing="8" fill="#9fe9cf" text-anchor="middle">FULL TIME</text>

  <text x="150" y="250" font-size="30" font-weight="700" fill="#eafff5" text-anchor="middle">RIVERSIDE FC</text>
  <text x="750" y="250" font-size="28" font-weight="700" fill="#eafff5" text-anchor="middle">HARBOUR ATHLETIC</text>
  <text x="360" y="320" font-size="120" font-weight="800" fill="#eafff5" text-anchor="middle" font-family="monospace">3</text>
  <text x="450" y="312" font-size="70" font-weight="700" fill="#7fcab2" text-anchor="middle">-</text>
  <text x="540" y="320" font-size="120" font-weight="800" fill="#eafff5" text-anchor="middle" font-family="monospace">1</text>

  <rect x="80" y="380" width="740" height="760" fill="rgba(0,0,0,.28)"/>
  <text x="450" y="450" font-size="22" font-weight="700" letter-spacing="6" fill="#9fe9cf" text-anchor="middle">MATCH STATS</text>

  <text x="160" y="526" font-size="26" font-weight="700" fill="#eafff5" text-anchor="middle" font-family="monospace">58%</text>
  <text x="450" y="524" font-size="18" font-weight="600" letter-spacing="3" fill="#9fe9cf" text-anchor="middle">POSSESSION</text>
  <text x="740" y="526" font-size="26" font-weight="700" fill="#eafff5" text-anchor="middle" font-family="monospace">42%</text>
  <rect x="130" y="540" width="371" height="26" fill="#1de08a"/>
  <rect x="501" y="540" width="269" height="26" fill="#3a4a45"/>

  ${row(660, "14", "Shots", "8")}
  ${row(738, "7", "Shots on Target", "4")}
  ${row(816, "286", "Passes", "241")}
  ${row(894, "84%", "Pass Accuracy", "79%")}
  ${row(972, "9", "Tackles", "12")}
  ${row(1050, "5", "Fouls", "7")}

  <text x="450" y="1210" font-size="18" font-weight="600" letter-spacing="4" fill="#7fcab2" text-anchor="middle">PRESS  X  TO CONTINUE</text>
</svg>`;

const sharp = (await import("sharp")).default;
mkdirSync(join(here, "..", "images"), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("Wrote " + out);
