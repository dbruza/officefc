/**
 * VERSION is the single source of truth for the release number. This propagates it to
 * package.json (the full 4-digit version) and to mobile/app.json `expo.version`, which
 * becomes the store-facing CFBundleShortVersionString / versionName — Apple allows at
 * most three integers there, so the MICRO digit is dropped.
 *
 * `--check` reports drift and exits non-zero instead of writing, so CI catches a VERSION
 * bump that never reached the app config (TestFlight silently shipping the old number).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const check = process.argv.includes("--check");

const version = readFileSync(resolve("VERSION"), "utf8").trim();
if (!VERSION_PATTERN.test(version)) {
  console.error(`VERSION must be MAJOR.MINOR.PATCH.MICRO (got "${version}").`);
  process.exit(1);
}
const storeVersion = version.split(".").slice(0, 3).join(".");

const targets = [
  {
    path: "package.json",
    label: "package.json version",
    expected: version,
    read: (json) => json.version,
    write: (json) => {
      json.version = version;
    },
  },
  {
    path: "mobile/app.json",
    label: "mobile/app.json expo.version",
    expected: storeVersion,
    read: (json) => json.expo?.version,
    write: (json) => {
      json.expo.version = storeVersion;
    },
  },
];

const drift = [];
for (const target of targets) {
  const file = resolve(target.path);
  const json = JSON.parse(readFileSync(file, "utf8"));
  const current = target.read(json);
  if (current === target.expected) continue;
  drift.push(`${target.label}: ${current} → ${target.expected}`);
  if (check) continue;
  target.write(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

if (drift.length === 0) {
  console.log(`Versions match VERSION ${version} (stores show ${storeVersion}).`);
  process.exit(0);
}

if (check) {
  console.error(`Version drift from VERSION ${version}:`);
  for (const line of drift) console.error(`  ${line}`);
  console.error("Run `npm run version:sync` to update them.");
  process.exit(1);
}

console.log(`Synced to VERSION ${version}:`);
for (const line of drift) console.log(`  ${line}`);
