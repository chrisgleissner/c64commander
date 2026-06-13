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
      "react-hooks/exhaustive-deps": "off",
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
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
