// Minimal, non-type-checked lint for our own source. Two surfaces get the full
// TypeScript ruleset (the Firebase functions and the Expo app); Node scripts and
// test files get a lighter JS pass with Node globals. Formatting is owned by
// Prettier — eslint-config-prettier (last) disables any rule that would fight it.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      ".claude/worktrees/**",
      ".codex/**",
      "**/node_modules/**",
      "**/lib/**", // functions build output
      "**/dist/**", // expo web export
      "**/.expo/**",
      "build/**",
      "prototype/**",
      "eval/**",
      "**/*.html",
    ],
  },

  // TypeScript source: functions backend + Expo app.
  {
    files: ["functions/src/**/*.ts", "mobile/src/**/*.{ts,tsx}", "mobile/app/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-undef": "off", // TypeScript already resolves names; the core rule only adds false positives.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "preserve-caught-error": "warn", // best-practice nudge, not a build blocker
    },
  },

  // The extraction core is portable ESM JS shared with the root test runner.
  {
    files: ["functions/src/extract/core/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  // Node scripts + every test runner (root .mjs, functions .js).
  {
    files: [
      "scripts/**/*.mjs",
      "test/**/*.mjs",
      "functions/test/**/*.js",
      "mobile/serve-web.js",
      "eslint.config.mjs",
    ],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },

  prettier,
);
