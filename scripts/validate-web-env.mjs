import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];

function parseEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

const envPath = resolve("mobile/.env");
let fileValues = {};
try {
  fileValues = parseEnv(readFileSync(envPath, "utf8"));
} catch {
  console.error(
    "Missing mobile/.env. Copy mobile/.env.example and add the office-fc web app config.",
  );
  process.exit(1);
}

const values = { ...process.env, ...fileValues };
const missing = REQUIRED_KEYS.filter((key) => !values[key]);
if (missing.length) {
  console.error(`Missing production web variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (values.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== "office-fc") {
  console.error("EXPO_PUBLIC_FIREBASE_PROJECT_ID must be office-fc for the MVP production build.");
  process.exit(1);
}
if (values.EXPO_PUBLIC_USE_EMULATORS !== "0") {
  console.error("EXPO_PUBLIC_USE_EMULATORS must be exactly 0 for a production web build.");
  process.exit(1);
}

console.log("Production web environment validated for Firebase project office-fc.");
