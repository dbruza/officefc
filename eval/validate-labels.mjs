/* Validate eval label files — run before launching the eval harness to catch issues early.

     node eval/validate-labels.mjs

   Checks that every label JSON is well-formed, references an existing image, and has
   all required expected fields. Prints a summary and exits non-zero on errors. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const labelsDir = join(here, "labels");
const imagesDir = join(here, "images");

const REQUIRED_FIELDS = ["detected_screen", "home", "away"];
const REQUIRED_HOME_AWAY = ["team_name", "goals", "possession", "shots", "shots_on_target"];

let errors = 0;
let warnings = 0;

function warn(msg) { console.warn("  ⚠ " + msg); warnings++; }
function err(msg) { console.error("  ✖ " + msg); errors++; }

const labelFiles = readdirSync(labelsDir).filter((f) => f.endsWith(".json"));

if (labelFiles.length === 0) {
  console.log("No label files found in eval/labels/.");
  process.exit(0);
}

console.log(`Validating ${labelFiles.length} label file(s)…\n`);

for (const lf of labelFiles) {
  const labelPath = join(labelsDir, lf);
  let label;
  try {
    label = JSON.parse(readFileSync(labelPath, "utf8"));
  } catch (e) {
    err(`${lf}: invalid JSON (${e.message})`);
    continue;
  }

  if (typeof label !== "object" || label === null) { err(`${lf}: root must be an object`); continue; }

  // image field
  if (typeof label.image !== "string") {
    err(`${lf}: missing or non-string "image" field`);
  } else {
    const imagePath = join(imagesDir, label.image);
    if (!existsSync(imagePath)) {
      err(`${lf}: referenced image "${label.image}" not found in eval/images/`);
    }
  }

  // synthetic tag
  if (label.synthetic) warn(`${lf}: marked synthetic — replace with a real image before measuring accuracy.`);

  // expected block
  const exp = label.expected;
  if (!exp || typeof exp !== "object") {
    err(`${lf}: missing or non-object "expected" block`);
    continue;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in exp)) err(`${lf}: expected.${field} is missing`);
  }

  // home / away sub-objects
  for (const side of ["home", "away"]) {
    const obj = exp[side];
    if (!obj || typeof obj !== "object") { err(`${lf}: expected.${side} must be an object`); continue; }
    for (const field of REQUIRED_HOME_AWAY) {
      if (field === "goals" && typeof obj[field] !== "number") err(`${lf}: expected.${side}.goals must be a number`);
      else if (field !== "goals" && exp.detected_screen !== false && !(field in obj))
        err(`${lf}: expected.${side}.${field} is missing`);
    }
    if (typeof obj.goals === "number" && (obj.goals < 0 || obj.goals > 99)) warn(`${lf}: expected.${side}.goals=${obj.goals} seems unrealistic`);
    if (typeof obj.possession === "number" && (obj.possession < 0 || obj.possession > 100)) warn(`${lf}: expected.${side}.possession=${obj.possession} out of range`);
  }

  // non-stats images
  if (exp.detected_screen === false) {
    console.log(`  ${lf}: non-stats image (expect rejection)`);
  } else if (errors === 0) {
    console.log(`  ${lf}: OK`);
  }
}

console.log(`\n${labelFiles.length} label(s) checked — ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
