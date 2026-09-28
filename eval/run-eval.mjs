/* OfficeFC — extraction eval harness.
   Compares the extractor's output against labeled stats-screen images.

     node eval/run-eval.mjs                  # MOCK mode (no network) — exercises the harness
     node eval/run-eval.mjs --real           # REAL mode — scores the model vs labels
     node eval/run-eval.mjs --real --model meta/muse-spark-1.3  # score another OpenRouter model
     node eval/run-eval.mjs --real --output results.csv       # CSV output for tracking

   Grow the set by dropping an image in eval/images/ and a matching label in
   eval/labels/. Goals accuracy is the headline metric (it's what moves ELO). */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractMatchFromImage } from "../functions/src/extract/core/extract.mjs";
import { mockResponse } from "../functions/src/extract/core/openrouter.mjs";
import { DEFAULT_MODEL } from "../functions/src/extract/core/schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const labelsDir = join(here, "labels");
const imagesDir = join(here, "images");

const args = process.argv.slice(2);
const MODE = args.includes("--real") && process.env.OPENROUTER_API_KEY ? "REAL" : "MOCK";
const MODEL = args.find((_, i) => args[i - 1] === "--model") || process.env.EXTRACTION_MODEL || DEFAULT_MODEL;
const OUTPUT = args.find((_, i) => args[i - 1] === "--output") || null;
const apiKey = process.env.OPENROUTER_API_KEY;
const baseUrl = process.env.OPENROUTER_BASE_URL || undefined;

if (args.includes("--real") && !apiKey) {
  console.error("--real requires OPENROUTER_API_KEY in the environment.");
  process.exit(1);
}

const mediaTypeFor = (f) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : "image/png");
const eq = (a, b) => a === b;
const near = (a, b, t = 2) => a !== null && b !== null && Math.abs(a - b) <= t;

const FIELDS = ["home_goals", "away_goals", "home_possession", "away_possession", "home_shots", "away_shots", "home_soT", "away_soT"];

function compare(got, exp) {
  const goalsHit = eq(got.home.goals, exp.home.goals) && eq(got.away.goals, exp.away.goals);
  const fieldResults = {
    home_goals: eq(got.home.goals, exp.home.goals),
    away_goals: eq(got.away.goals, exp.away.goals),
    home_possession: near(got.home.possession, exp.home.possession),
    away_possession: near(got.away.possession, exp.away.possession),
    home_shots: eq(got.home.shots, exp.home.shots),
    away_shots: eq(got.away.shots, exp.away.shots),
    home_soT: eq(got.home.shots_on_target, exp.home.shots_on_target),
    away_soT: eq(got.away.shots_on_target, exp.away.shots_on_target),
  };
  const statsHit = Object.values(fieldResults).filter(Boolean).length - (fieldResults.home_goals ? 1 : 0) - (fieldResults.away_goals ? 1 : 0);
  const statsTotal = 6;
  return { goalsHit, fieldResults, statsHit, statsTotal };
}

async function run() {
  const labels = readdirSync(labelsDir).filter((f) => f.endsWith(".json"));
  if (labels.length === 0) {
    console.log("No labels in eval/labels — add <name>.json + eval/images/<image>.");
    return;
  }
  console.log(`\nOfficeFC extraction eval — ${MODE} mode · ${labels.length} image(s) · model ${MODEL}\n`);

  let goalsRight = 0;
  const fieldRight = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let errors = 0;
  const csvRows = [["image", "goals_match", "confidence", "requires_review", "error", ...FIELDS].join(",")];

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
          baseUrl,
          model: MODEL,
        });
      } else {
        const caller = async () =>
          mockResponse({ detected_screen: exp.detected_screen, confidence: 0.95, home: exp.home, away: exp.away });
        result = await extractMatchFromImage({ imageBase64: "x", caller });
      }
    } catch (e) {
      console.log(`✖ ${label.image}: ${e.message}`);
      errors++;
      if (OUTPUT) csvRows.push([label.image, "0", "0", "", e.message, ...FIELDS.map(() => "0")]);
      continue;
    }

    if (!result.ok || !result.suggestion) {
      console.log(`✖ ${label.image}: not detected as stats screen (reason: ${result.reason || "?"})`);
      errors++;
      if (OUTPUT) csvRows.push([label.image, "0", "0", "", `not_detected:${result.reason || "?"}`, ...FIELDS.map(() => "0")]);
      continue;
    }

    const c = compare(result.suggestion, exp);
    goalsRight += c.goalsHit ? 1 : 0;
    for (const f of FIELDS) if (c.fieldResults[f]) fieldRight[f]++;

    const conf = result.confidence.toFixed(2);
    console.log(
      `${c.goalsHit ? "✔" : "✖"} ${label.image}  ` +
      `score ${result.suggestion.home.goals}-${result.suggestion.away.goals} ` +
      `(exp ${exp.home.goals}-${exp.away.goals})  ` +
      `stats ${c.statsHit}/${c.statsTotal}  conf ${conf}` +
      (result.requiresReview ? "  [review]" : ""),
    );

    if (OUTPUT) {
      csvRows.push([
        label.image,
        c.goalsHit ? "1" : "0",
        conf,
        result.requiresReview ? "1" : "0",
        "",
        ...FIELDS.map((f) => (c.fieldResults[f] ? "1" : "0")),
      ].join(","));
    }
  }

  const n = labels.length - errors;
  console.log(`\nGoals accuracy: ${goalsRight}/${n}` + (n ? ` (${Math.round((goalsRight / n) * 100)}%)` : ""));
  console.log("Per-field accuracy:");
  for (const f of FIELDS) {
    console.log(`  ${f.padEnd(20)} ${fieldRight[f]}/${n}` + (n ? ` (${Math.round((fieldRight[f] / n) * 100)}%)` : ""));
  }
  if (errors) console.log(`Errors: ${errors}`);
  console.log(MODE === "MOCK" ? "\n(MOCK mode — set OPENROUTER_API_KEY and use --real to score the real model.)\n" : "");

  if (OUTPUT) {
    writeFileSync(OUTPUT, csvRows.join("\n"), "utf8");
    console.log(`Results written to ${OUTPUT}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
