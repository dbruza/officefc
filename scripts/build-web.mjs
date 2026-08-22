import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  allowPlaceholderConfig,
  findMissingInlinedKeys,
  findShippedPlaceholders,
  readWebEnv,
} from "./web-env.mjs";

const env = readWebEnv();
if (!env) {
  console.error("Missing mobile/.env — run npm run validate:web-env for details.");
  process.exit(1);
}

const result = spawnSync(
  "npm",
  // --clear: Metro's transform cache key does not track the EXPO_PUBLIC_* values that
  // babel-preset-expo inlines, so a firebase.ts transformed once against the CI
  // placeholders is reused forever. That stale entry is exactly what shipped the
  // "ci-api-key" bundle to production. A release artifact is worth a cold build.
  ["--prefix", "mobile", "run", "export:web", "--", "--clear"],
  {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      EXPO_PUBLIC_USE_EMULATORS: "0",
      // mobile/.env carries EXPO_PUBLIC_SENTRY_ENV=development for local dev; the production
      // web bundle must never inherit that label or web events land in the wrong environment.
      EXPO_PUBLIC_SENTRY_ENV: "production",
    },
    stdio: "inherit",
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const bundleDir = resolve("mobile/dist/_expo/static/js/web");
const bundlePaths = readdirSync(bundleDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => join(bundleDir, name));
if (!bundlePaths.length) {
  console.error("Web export did not produce a JavaScript bundle.");
  process.exit(1);
}
const emitted = bundlePaths.map((path) => readFileSync(path, "utf8"));

const forbidden = [
  ":9099",
  ":9199",
  "localhost:9099",
  "localhost:8080",
  "localhost:9199",
  "localhost:5001",
  "10.0.2.2:9099",
  "10.0.2.2:8080",
  "10.0.2.2:9199",
  "10.0.2.2:5001",
];
for (const bundle of emitted) {
  const match = forbidden.find((value) => bundle.includes(value));
  if (match) {
    console.error(`Production bundle contains forbidden emulator endpoint: ${match}`);
    process.exit(1);
  }
}

// Check the artifact, not the inputs. validate:web-env proves mobile/.env is correct, which
// says nothing about what Babel actually inlined — the deploy that locked everyone out
// passed that check with a correct .env and a bundle built from a stale cached transform.
// Reading the emitted config back is the only assertion a poisoned cache cannot satisfy.
const notInlined = findMissingInlinedKeys(emitted, env);
if (notInlined.length) {
  console.error(
    `Bundle does not carry the mobile/.env value for: ${notInlined.join(", ")}. ` +
      "The export used a stale transform — rerun with a cleared cache before deploying.",
  );
  process.exit(1);
}

if (!allowPlaceholderConfig) {
  const shipped = findShippedPlaceholders(emitted);
  if (shipped.length) {
    console.error(
      `Production bundle carries CI placeholder Firebase config: ${shipped.join(", ")}. ` +
        "Sign-in would fail for every user with 400 API_KEY_INVALID.",
    );
    process.exit(1);
  }
}

const fontDir = resolve("mobile/dist/assets/node_modules");
if (!statSync(fontDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("Web export is missing bundled font assets.");
  process.exit(1);
}

console.log("Production web bundle passed emulator, Firebase config, and asset checks.");
