/**
 * Unit tests for the production web config gate.
 *
 * The failure these exist for: a v1.4.1.0 deploy shipped the CI placeholder Firebase
 * config, so every sign-in came back 400 API_KEY_INVALID and the whole league was locked
 * out of the web app. The old validator waved it through — it only checked that the six
 * values were non-empty, which the placeholders are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMissingInlinedKeys,
  findShippedPlaceholders,
  validateWebEnv,
} from "../scripts/web-env.mjs";

/** A well-formed web config for an example project. Realistic in shape, not a real key. */
function validConfig(overrides = {}) {
  return {
    EXPO_PUBLIC_FIREBASE_API_KEY: "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "acme-league.firebaseapp.com",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "acme-league",
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "acme-league.firebasestorage.app",
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456789012",
    EXPO_PUBLIC_FIREBASE_APP_ID: "1:123456789012:web:abc123def456abc123",
    EXPO_PUBLIC_USE_EMULATORS: "0",
    ...overrides,
  };
}

/** Exactly what .github/workflows/ci.yml writes into mobile/.env. */
function ciConfig() {
  return validConfig({
    EXPO_PUBLIC_FIREBASE_API_KEY: "ci-api-key",
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
    EXPO_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:ci",
  });
}

test("a real project config passes", () => {
  assert.deepEqual(validateWebEnv(validConfig()), []);
});

test("the CI placeholder config is rejected", () => {
  const problems = validateWebEnv(ciConfig());
  assert.ok(problems.length > 0, "placeholder config must not be deployable");
  assert.ok(problems.some((p) => p.includes("EXPO_PUBLIC_FIREBASE_API_KEY")));
});

test("a placeholder nobody listed is still rejected", () => {
  // The literal list only knows today's stand-ins; the shape rule is what closes the class.
  for (const key of ["fake-api-key", "TODO", "changeme", "AIza-too-short"]) {
    const problems = validateWebEnv(validConfig({ EXPO_PUBLIC_FIREBASE_API_KEY: key }));
    assert.ok(problems.length > 0, `${key} must not pass as a Firebase browser key`);
  }
});

test("CI's opt-out stands down credential realism but not project targeting", () => {
  assert.deepEqual(validateWebEnv(ciConfig(), { allowPlaceholders: true }), []);

  const wrongProject = validConfig({ EXPO_PUBLIC_FIREBASE_PROJECT_ID: "acme-league-staging" });
  assert.equal(
    validateWebEnv(wrongProject, { allowPlaceholders: true, activeProjectId: "acme-league" })
      .length,
    1,
  );

  const emulators = validConfig({ EXPO_PUBLIC_USE_EMULATORS: "1" });
  assert.ok(
    validateWebEnv(emulators, { allowPlaceholders: true }).some((p) =>
      p.includes("EXPO_PUBLIC_USE_EMULATORS"),
    ),
  );
});

test("the app must target the project firebase deploy will use", () => {
  assert.deepEqual(validateWebEnv(validConfig(), { activeProjectId: "acme-league" }), []);
  const problems = validateWebEnv(validConfig(), { activeProjectId: "other-league" });
  assert.ok(problems.some((p) => p.includes("active Firebase project is other-league")));
});

test("the app's functions region must match the deployed one", () => {
  // Both unset: both sides fall back to us-central1.
  assert.deepEqual(validateWebEnv(validConfig()), []);

  const sydney = validConfig({ EXPO_PUBLIC_FUNCTIONS_REGION: "australia-southeast1" });
  assert.ok(
    validateWebEnv(sydney).some((p) => p.includes("functions deploy to us-central1")),
    "an app pointed at Sydney must not ship against Iowa functions",
  );
  assert.deepEqual(
    validateWebEnv(sydney, { functionsEnv: { FUNCTIONS_REGION: "australia-southeast1" } }),
    [],
  );
});

test("AI features in the app need the AI functions deployed", () => {
  const aiApp = validConfig({ EXPO_PUBLIC_AI_FEATURES: "1" });
  assert.ok(validateWebEnv(aiApp).some((p) => p.includes("AI_FEATURES")));
  assert.deepEqual(validateWebEnv(aiApp, { functionsEnv: { AI_FEATURES: "true" } }), []);
  // Backend on, app off is harmless: the functions just go unused.
  assert.deepEqual(validateWebEnv(validConfig(), { functionsEnv: { AI_FEATURES: "true" } }), []);
});

test("the emulator-only example config can't ship", () => {
  const example = validConfig({
    EXPO_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-officefc.firebaseapp.com",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "demo-officefc",
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-officefc.firebasestorage.app",
  });
  assert.ok(validateWebEnv(example).some((p) => p.includes("emulator-only demo project")));
  // CI builds against it deliberately, with the realism rules stood down.
  assert.deepEqual(validateWebEnv(example, { allowPlaceholders: true }), []);
});

test("every missing variable is named in one message", () => {
  const problems = validateWebEnv(
    validConfig({ EXPO_PUBLIC_FIREBASE_API_KEY: "", EXPO_PUBLIC_FIREBASE_APP_ID: "" }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /EXPO_PUBLIC_FIREBASE_API_KEY/);
  assert.match(problems[0], /EXPO_PUBLIC_FIREBASE_APP_ID/);
});

test("a config assembled from two different apps is rejected", () => {
  const mixed = validConfig({ EXPO_PUBLIC_FIREBASE_APP_ID: "1:999999999999:web:abc123" });
  assert.ok(validateWebEnv(mixed).some((p) => p.includes("copy all six values from one app")));
});

test("Firebase-owned domains must belong to the project, custom ones need not", () => {
  const foreign = validConfig({
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "some-other-project.firebaseapp.com",
  });
  assert.ok(validateWebEnv(foreign).some((p) => p.includes("different Firebase project")));

  const custom = validConfig({ EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "auth.example.com" });
  assert.deepEqual(validateWebEnv(custom), []);

  const pastedUrl = validConfig({
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "https://acme-league.firebaseapp.com/",
  });
  assert.ok(validateWebEnv(pastedUrl).some((p) => p.includes("bare hostname")));
});

test("the storage bucket must be one the console actually hands out", () => {
  // .env.example warns about this exact confusion: newer projects are .firebasestorage.app,
  // older ones .appspot.com, and a hand-typed bucket silently breaks every upload.
  assert.deepEqual(
    validateWebEnv(validConfig({ EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "acme-league.appspot.com" })),
    [],
  );

  const invented = validConfig({ EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "acme-league-uploads" });
  assert.ok(
    validateWebEnv(invented).some((p) => p.includes("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET")),
  );

  const foreign = validConfig({
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "other-project.firebasestorage.app",
  });
  assert.ok(validateWebEnv(foreign).some((p) => p.includes("different Firebase project")));
});

test("a bundle missing an inlined value is caught whatever quote style the minifier chose", () => {
  const values = validConfig();
  const singleQuoted = Object.values(values)
    .map((value) => `'${value}'`)
    .join(",");
  assert.deepEqual(findMissingInlinedKeys([singleQuoted], values), []);

  const stale = singleQuoted.replace(`'${values.EXPO_PUBLIC_FIREBASE_API_KEY}'`, "'ci-api-key'");
  assert.deepEqual(findMissingInlinedKeys([stale], values), ["EXPO_PUBLIC_FIREBASE_API_KEY"]);
});

test("placeholders emitted into the bundle are caught, unrelated identifiers are not", () => {
  assert.deepEqual(findShippedPlaceholders([`{apiKey:"ci-api-key"}`]), ["ci-api-key"]);
  // Substring matching would fire on this and block a clean release.
  assert.deepEqual(findShippedPlaceholders([`{apiKey:"ci-api-keyring-service"}`]), []);
});
