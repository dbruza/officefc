import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Expo Router declarations are generated and ignored. A stale local copy can
// describe routes that no longer match the app, so CI starts from a clean cache.
rmSync(resolve("mobile/.expo/types/router.d.ts"), { force: true });

const result = spawnSync("npm", ["--prefix", "mobile", "run", "typecheck"], {
  cwd: resolve("."),
  stdio: "inherit",
});

process.exit(result.status ?? 1);
