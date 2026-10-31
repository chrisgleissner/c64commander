/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
import path from "node:path";
import { ESLint } from "eslint";

const ROOT = process.cwd();

/**
 * The repository's own lint rules without the type-aware ones. Building the TypeScript program for those takes
 * twenty seconds, and the rules a test of the syntax and import restrictions looks at do not read types.
 */
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    {
      files: ["src/**/*.{ts,tsx}"],
      languageOptions: { parserOptions: { project: false } },
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
        "@typescript-eslint/no-duplicate-type-constituents": "off",
      },
    },
  ],
});

/** The ids of the rules `code` breaks when it is linted as the file at `filePath` (relative to the repository). */
export const rulesHit = async (code: string, filePath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, filePath) });
  return result.messages.map((message) => message.ruleId ?? "parse-error");
};
