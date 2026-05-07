/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const scriptPath = resolve(repoRoot, "scripts", "check-bundle-budgets.mjs");

const runGuard = (cwd: string, extraArgs: string[] = []) =>
  spawnSync("node", [scriptPath, ...extraArgs], {
    cwd,
    encoding: "utf-8",
  });

describe("check-bundle-budgets.mjs", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(resolve(tmpdir(), "bundle-budgets-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("succeeds when no chunks exceed the budget", () => {
    const assetsDir = resolve(workDir, "dist", "assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(resolve(assetsDir, "small.js"), "console.log('hi');\n");

    const result = runGuard(workDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/budget 250\.00 KB gzipped/);
  });

  it("fails when a chunk exceeds the gzipped budget", () => {
    const assetsDir = resolve(workDir, "dist", "assets");
    mkdirSync(assetsDir, { recursive: true });
    // Use crypto-random bytes so gzip cannot compress; need ~260 KB to push
    // gzipped output over the 250 KB budget.
    writeFileSync(resolve(assetsDir, "huge.js"), randomBytes(260 * 1024));

    const result = runGuard(workDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/exceed the.*250\.00 KB gzipped cap/);
  });

  it("returns non-zero when dist is missing without --skip-if-missing", () => {
    const result = runGuard(workDir);
    expect(result.status).toBe(2);
  });

  it("skips silently when dist is missing and --skip-if-missing is passed", () => {
    const result = runGuard(workDir, ["--skip-if-missing"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skipping/);
  });
});
