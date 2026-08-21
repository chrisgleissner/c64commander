import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "artifacts/**",
      "ci-artifacts/**",
      ".cov-unit/**",
      ".nyc_output/**",
      "android/**/build/**",
      "android/**/src/main/assets/**",
      "test-results/**",
      "coverage/**",
      "playwright-report/**",
      ".worktrees/**",
      // The libsidplayfp engine synced out of the npm package by
      // scripts/sync-libsidplayfp-wasm.mjs. Vendored build output, gitignored and never written by
      // hand, so linting it only reports on someone else's code — and it does: the package's
      // `songlengths.d.ts` trips no-unused-private-class-members, which failed `npm run lint` (and
      // so `./build`) on any working copy where the sync had already run.
      "public/wasm/libsidplayfp/**",
      // `cap sync` copies public/ verbatim into each native project, so the same vendored engine
      // reappears there. Android's copy is already covered by the assets rule above; iOS's is not,
      // and it failed the build for exactly the same reason one sync later.
      "ios/App/App/public/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Deliberately off. This repository's worst recurring failure is an effect
      // whose dependency is referentially unstable but value-equal: it loops
      // synchronously, starves the event loop, and surfaces as an indefinite
      // Vitest hang rather than a failing test (REVIEW.md hazard 1). Completing a
      // dependency array on the rule's say-so is how that loop gets introduced,
      // so dependencies here are a deliberate choice, not an oversight.
      "react-hooks/exhaustive-deps": "off",
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Shipped code only. An unused binding here is either dead code or a
    // symptom - something computed and then never applied. Turning this on
    // found 87, among them a shipped setting whose handler nothing calls and a
    // config merge whose result was discarded. Prefix a genuinely unused
    // variable with `_` to say it is unused on purpose.
    //
    // Not yet on for tests/, playwright/, c64scope/ and scripts/: they hold 121
    // more, and 75 of those are `const x = call()` where the call still has to
    // run, so each needs reading rather than deleting.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  // Telnet and diagnostics paths must use structured addLog/addErrorLog,
  // never raw console.log. console.log lands as a JNI-bridged
  // "Msg: undefined" line in Android logcat when the first arg is undefined,
  // which the responsiveness research flagged as overhead during Telnet
  // activity.
  {
    files: ["src/lib/telnet/**/*.{ts,tsx}", "src/lib/diagnostics/**/*.{ts,tsx}"],
    rules: {
      "no-console": [
        "error",
        {
          allow: ["warn", "error", "info", "debug"],
        },
      ],
    },
  },
);
