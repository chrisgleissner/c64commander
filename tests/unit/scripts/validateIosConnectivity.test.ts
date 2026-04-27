import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDirs: string[] = [];
const sourceScriptPath = path.resolve(process.cwd(), "scripts/ci/validate-ios-connectivity.sh");

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("validate-ios-connectivity.sh", () => {
  it("skips cleanly when a flow artifacts directory is missing", () => {
    const repoDir = createTempDir("validate-ios-connectivity-missing-");
    const scriptsDir = path.join(repoDir, "scripts", "ci");
    const scriptPath = path.join(scriptsDir, "validate-ios-connectivity.sh");
    const missingFlowDir = path.join(repoDir, "artifacts", "ios", "ios-config-persistence");

    mkdirSync(scriptsDir, { recursive: true });
    copyFileSync(sourceScriptPath, scriptPath);
    chmodSync(scriptPath, 0o755);

    const result = spawnSync("bash", [scriptPath, missingFlowDir], {
      cwd: repoDir,
      encoding: "utf8",
      env: process.env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Flow artifacts directory missing for ios-config-persistence");
  });

  it("writes connectivity-validation.json for an existing flow directory", () => {
    const repoDir = createTempDir("validate-ios-connectivity-existing-");
    const scriptsDir = path.join(repoDir, "scripts", "ci");
    const scriptPath = path.join(scriptsDir, "validate-ios-connectivity.sh");
    const flowDir = path.join(repoDir, "artifacts", "ios", "ios-ci-smoke");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(flowDir, { recursive: true });
    copyFileSync(sourceScriptPath, scriptPath);
    chmodSync(scriptPath, 0o755);
    writeFileSync(path.join(flowDir, "errorLog.json"), "[]\n", "utf8");
    writeFileSync(path.join(flowDir, "action.json"), "[]\n", "utf8");
    writeFileSync(path.join(flowDir, "network.json"), '{"requests":[],"successCount":0,"failureCount":0}\n', "utf8");

    const result = spawnSync("bash", [scriptPath, flowDir], {
      cwd: repoDir,
      encoding: "utf8",
      env: process.env,
    });
    const validationPath = path.join(flowDir, "connectivity-validation.json");
    const validationContents = readFileSync(validationPath, "utf8");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"flow": "ios-ci-smoke"');
    expect(result.stdout).toContain('"valid": true');
    expect(validationContents).toContain('"flow": "ios-ci-smoke"');
    expect(validationContents).toContain('"valid": true');
    expect(JSON.parse(validationContents)).toEqual(JSON.parse(result.stdout));
  });
});
