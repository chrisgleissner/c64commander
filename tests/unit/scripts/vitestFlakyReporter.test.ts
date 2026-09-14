/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = process.cwd();
const vitestEntry = path.join(rootDir, "node_modules/vitest/vitest.mjs");
const reporterPath = path.join(rootDir, "tests/reporters/vitestFlakyReporter.ts");

const tempDirs: string[] = [];

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

// The child run must not write annotations or a job summary into the CI job running this test.
const childEnv = () => {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  delete env.GITHUB_STEP_SUMMARY;
  delete env.CI;
  return env;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("vitestFlakyReporter under the installed vitest", () => {
  it("reports a test that passed only after a retry", () => {
    const projectDir = createTempDir("vitest-flaky-reporter-");
    writeFileSync(
      path.join(projectDir, "vitest.config.mjs"),
      `export default { test: { include: ["flaky.test.mjs"], globals: true, retry: 1, reporters: ["default", ${JSON.stringify(reporterPath)}] } };\n`,
    );
    writeFileSync(
      path.join(projectDir, "flaky.test.mjs"),
      [
        "let attempts = 0;",
        'test("passes on the second attempt", () => {',
        "  attempts += 1;",
        '  if (attempts === 1) throw new Error("first attempt fails");',
        "});",
        'test("passes on the first attempt", () => {});',
        "",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [vitestEntry, "run", "--config", "vitest.config.mjs"], {
      cwd: projectDir,
      env: childEnv(),
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("FLAKY UNIT TESTS DETECTED: 1 test(s) passed ONLY on retry");

    const reportDir = path.join(projectDir, "test-results", "flaky");
    const reports = readdirSync(reportDir).filter((name) => name.startsWith("flaky-unit-"));
    expect(reports).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(reportDir, reports[0]), "utf8"))).toEqual({
      shard: "unit",
      count: 1,
      tests: [{ name: "passes on the second attempt", file: "flaky.test.mjs", retries: 1 }],
    });
  });
});
