/* OfficeFC — extraction eval harness.
   Compares the extractor's output against labeled stats-screen images.

     node eval/run-eval.mjs            # MOCK mode (no network) — exercises the harness
     ANTHROPIC_API_KEY=… node eval/run-eval.mjs   # REAL mode — scores Claude vs labels

   Grow the set by dropping an image in eval/images/ and a matching label in
   eval/labels/. Goals accuracy is the headline metric (it's what moves ELO). */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractMatchFromImage } from "../functions/src/extract/core/extract.mjs";
import { mockResponse } from "../functions/src/extract/core/anthropic.mjs";
import { DEFAULT_MODEL } from "../functions/src/extract/core/schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const labelsDir = join(here, "labels");
const imagesDir = join(here, "images");
const apiKey = process.env.ANTHROPIC_API_KEY;
const MODE = apiKey ? "REAL" : "MOCK";

const mediaTypeFor = (f) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : "image/png");
const eq = (a, b) => a === b;
const near = (a, b, t = 2) => a !== null && b !== null && Math.abs(a - b) <= t;

function compare(got, exp) {
  // headline: both goals exactly right
  const goalsHit = eq(got.home.goals, exp.home.goals) && eq(got.away.goals, exp.away.goals);
  // secondary stat fields
  const checks = [
    eq(got.home.shots, exp.home.shots), eq(got.away.shots, exp.away.shots),
    eq(got.home.shots_on_target, exp.home.shots_on_target), eq(got.away.shots_on_target, exp.away.shots_on_target),
    near(got.home.possession, exp.home.possession), near(got.away.possession, exp.away.possession),
  ];
  const statsHit = checks.filter(Boolean).length;
  return { goalsHit, statsHit, statsTotal: checks.length };
}

async function run() {
  const labels = readdirSync(labelsDir).filter((f) => f.endsWith(".json"));
  if (labels.length === 0) {
    console.log("No labels in eval/labels — add <name>.json + eval/images/<image>.");
    return;
  }
  console.log(`\nOfficeFC extraction eval — ${MODE} mode · ${labels.length} image(s)\n`);

  let goalsRight = 0, statsRight = 0, statsAll = 0, errors = 0;

  for (const lf of labels) {
    const label = JSON.parse(readFileSync(join(labelsDir, lf), "utf8"));
    const exp = label.expected;
    let result;
    try {
      if (MODE === "REAL") {
        const imageBase64 = readFileSync(join(imagesDir, label.image)).toString("base64");
        result = await extractMatchFromImage({
          imageBase64,
          mediaType: mediaTypeFor(label.image),
          apiKey,
          baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
          model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        });
      } else {
        // MOCK: feed the label back as the "model output" — proves the harness +
        // comparison run end-to-end offline (scores 100% by construction).
        const caller = async () =>
          mockResponse({ detected_screen: exp.detected_screen, confidence: 0.95, home: exp.home, away: exp.away });
        result = await extractMatchFromImage({ imageBase64: "x", caller });
      }
    } catch (e) {
      console.log(`✖ ${label.image}: ${e.message}`);
      errors++;
      continue;
    }

    if (!result.ok || !result.suggestion) {
      console.log(`✖ ${label.image}: not detected as a stats screen (reason: ${result.reason || "?"})`);
      errors++;
      continue;
    }
    const c = compare(result.suggestion, exp);
    goalsRight += c.goalsHit ? 1 : 0;
    statsRight += c.statsHit;
    statsAll += c.statsTotal;
    const conf = result.confidence.toFixed(2);
    console.log(
      `${c.goalsHit ? "✔" : "✖"} ${label.image}  ` +
      `score ${result.suggestion.home.goals}-${result.suggestion.away.goals} ` +
      `(exp ${exp.home.goals}-${exp.away.goals})  ` +
      `stats ${c.statsHit}/${c.statsTotal}  conf ${conf}` +
      (result.requiresReview ? "  [review]" : ""),
    );
  }

  const n = labels.length - errors;
  console.log(
    `\nGoals accuracy: ${goalsRight}/${n}` +
    (n ? ` (${Math.round((goalsRight / n) * 100)}%)` : "") +
    `   ·   Stat-field accuracy: ${statsRight}/${statsAll}` +
    (statsAll ? ` (${Math.round((statsRight / statsAll) * 100)}%)` : "") +
    (errors ? `   ·   errors: ${errors}` : "") + "\n",
  );
  if (MODE === "MOCK") console.log("(MOCK mode — set ANTHROPIC_API_KEY to score the real model.)\n");
}

run().catch((e) => { console.error(e); process.exit(1); });
