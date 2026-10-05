import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const result = spawnSync(
  process.execPath,
  [
    resolve("node_modules/firebase-tools/lib/bin/firebase.js"),
    "emulators:exec",
    "--config",
    process.env.FIREBASE_TEST_CONFIG ?? "firebase.test.json",
    "--project",
    "office-fc",
    "--only",
    "firestore,storage",
    // Integration files share one emulator and each wipes it before every test, so they
    // run one file at a time.
    "npm --prefix test/rules test && node --test --test-concurrency=1 functions/integration/*.test.cjs",
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
