import { allowPlaceholderConfig, readWebEnv, validateWebEnv } from "./web-env.mjs";

const values = readWebEnv();
if (!values) {
  console.error(
    "Missing mobile/.env. Copy mobile/.env.example and add the office-fc web app config.",
  );
  process.exit(1);
}

const problems = validateWebEnv(values, { allowPlaceholders: allowPlaceholderConfig });
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log("Production web environment validated for Firebase project office-fc.");
