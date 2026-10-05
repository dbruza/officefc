import {
  allowPlaceholderConfig,
  readActiveProjectId,
  readFunctionsEnv,
  readWebEnv,
  validateWebEnv,
} from "./web-env.mjs";

const values = readWebEnv();
if (!values) {
  console.error(
    "Missing mobile/.env. Copy mobile/.env.example and add your Firebase web app config.",
  );
  process.exit(1);
}

const activeProjectId = readActiveProjectId();
const problems = validateWebEnv(values, {
  allowPlaceholders: allowPlaceholderConfig,
  activeProjectId,
  functionsEnv: readFunctionsEnv(activeProjectId ?? values.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
});
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log(
  `Production web environment validated for Firebase project ${values.EXPO_PUBLIC_FIREBASE_PROJECT_ID}.`,
);
