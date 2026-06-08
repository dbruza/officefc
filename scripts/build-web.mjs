import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const result = spawnSync("npm", ["--prefix", "mobile", "run", "export:web"], {
  cwd: resolve("."),
  env: {
    ...process.env,
    NODE_ENV: "production",
    EXPO_PUBLIC_USE_EMULATORS: "0",
  },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const bundleDir = resolve("mobile/dist/_expo/static/js/web");
const bundles = readdirSync(bundleDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => join(bundleDir, name));
if (!bundles.length) {
  console.error("Web export did not produce a JavaScript bundle.");
  process.exit(1);
}

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
for (const bundlePath of bundles) {
  const bundle = readFileSync(bundlePath, "utf8");
  const match = forbidden.find((value) => bundle.includes(value));
  if (match) {
    console.error(`Production bundle contains forbidden emulator endpoint: ${match}`);
    process.exit(1);
  }
}

const fontDir = resolve("mobile/dist/assets/node_modules");
if (!statSync(fontDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("Web export is missing bundled font assets.");
  process.exit(1);
}

console.log("Production web bundle passed emulator and asset checks.");
