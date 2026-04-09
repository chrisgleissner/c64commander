import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const scriptPath = path.resolve(process.cwd(), "scripts/hvsc/assert-web-perf-budgets.mjs");

const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-budget-assert-"));
  tempDirs.push(root);
  return root;
};

const runAssert = (summaryPath: string, env: Record<string, string> = {}) => {
  try {
    const stdout = execFileSync("node", [scriptPath, `--file=${summaryPath}`], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error: unknown) {
    const err = error as { status: number; stdout: string; stderr: string };
    return {
      exitCode: err.status,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("assert-web-perf-budgets", () => {
  it("fails fast when a configured budget value is not numeric", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        metrics: {
          browseLoadSnapshotMs: { p95: 12 },
        },
      }),
    );

    const result = runAssert(summaryPath, {
      HVSC_BUDGET_BROWSE_LOAD_SNAPSHOT_P95: "not-a-number",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("browseLoadSnapshotMs: invalid budget value not-a-number");
  });

  it("passes when the configured budget is numeric and the metric is within budget", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        metrics: {
          browseLoadSnapshotMs: { p95: 12 },
        },
      }),
    );

    const result = runAssert(summaryPath, {
      HVSC_BUDGET_BROWSE_LOAD_SNAPSHOT_P95: "20",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HVSC web secondary perf budgets passed.");
  });
});
