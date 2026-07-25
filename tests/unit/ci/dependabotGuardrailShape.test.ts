import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Meta-guard for the Dependabot compatibility guardrails.
 *
 * History: the AGP↔Gradle guard has oscillated three times.
 *
 *   b444b375  derived AGP/Gradle versions from the repo (no hardcoding)
 *   2cd7b9bf  REGRESSED — "restore AGP↔wrapper lockstep guard via known-good
 *             pair matrix" reintroduced a hardcoded KNOWN_GOOD_AGP_WRAPPER_PAIRS
 *             table, so every routine Dependabot AGP bump failed CI until
 *             someone hand-edited the table
 *   600f3c25  fixed again — a structural major-version invariant
 *
 * The recurring failure mode is the *pattern*, not the specific table: a CI
 * guard that must be hand-edited whenever a dependency legitimately changes will
 * fail every routine Dependabot bump. That trains everyone to read a red check
 * as "flaky", which is exactly what makes a real failure easy to miss.
 *
 * So: guardrails may assert structural relationships and configuration
 * contracts, but never exact third-party version tuples. Real AGP↔Gradle
 * compatibility is proven by the Android build jobs, which already run on every
 * PR.
 */

const GUARDED_FILES = ["tests/unit/ci/dependabotContracts.test.ts"];

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

/**
 * Strips block comments, line comments and regex-ish string literals so that a
 * version number quoted in *documentation* (like the commit hashes and example
 * versions above) does not trip the check. What is left is executable code.
 */
const stripCommentary = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    // Version-shaped fragments inside a regex or a regex-building string are how
    // these guards *extract* a version, which is fine — it is pinning a specific
    // value that is forbidden.
    .replace(/\\d\+\\?\.?/g, "");

describe("dependabot guardrail shape", () => {
  it.each(GUARDED_FILES)("%s pins no third-party dependency version", (relativePath) => {
    const code = stripCommentary(readRepositoryFile(relativePath));

    const versionLiterals = code.match(/["'`]\s*\d+\.\d+\.\d+[^"'`]*["'`]/g) ?? [];
    expect(
      versionLiterals,
      `${relativePath} contains hardcoded dependency version literal(s): ${versionLiterals.join(", ")}. ` +
        `Guardrails must assert durable invariants (e.g. "AGP major === Gradle wrapper major") and configuration ` +
        `contracts, never exact third-party versions — a version list has to be hand-edited on every routine ` +
        `Dependabot bump, so it fails CI for changes that are perfectly fine. This regressed once already in ` +
        `2cd7b9bf and was fixed in 600f3c25; the real compatibility check is the Android build, which runs on ` +
        `every PR.`,
    ).toEqual([]);
  });

  it.each(GUARDED_FILES)("%s declares no known-good version lookup table", (relativePath) => {
    const code = stripCommentary(readRepositoryFile(relativePath));

    expect(
      /KNOWN_GOOD\w*(_PAIRS|_VERSIONS|_MATRIX)?\s*[:=]/.test(code),
      `${relativePath} reintroduces a KNOWN_GOOD_* lookup table. That is the exact shape reverted in 600f3c25: ` +
        `it makes every routine Dependabot bump fail CI until a human edits the table. Assert the structural ` +
        `invariant instead.`,
    ).toBe(false);
  });
});
