import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "android-budget-assert-"));
  tempDirs.push(root);
  return root;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

const scriptPath = path.resolve(process.cwd(), "scripts/hvsc/assert-android-perf-budgets.mjs");

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

describe("assert-android-perf-budgets", () => {
  it("reports observation-only when HVSC_ANDROID_BUDGET_ENFORCE is not set", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        loops: 3,
        warmup: 1,
        targetEvidence: {
          T1: { status: "pass", actualMs: 15000, budgetMs: 20000, source: "test" },
          T2: { status: "pass", actualMs: 20000, budgetMs: 25000, source: "test" },
          T3: { status: "pass", actualMs: 1500, budgetMs: 2000, source: "test" },
          T4: { status: "pass", actualMs: 1800, budgetMs: 2000, source: "test" },
          T5: { status: "pass", actualMs: 800, budgetMs: 1000, source: "test" },
        },
      }),
    );

    const result = runAssert(summaryPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("observation-only");
  });

  it("fails when enforced and a target exceeds budget", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        loops: 3,
        warmup: 1,
        targetEvidence: {
          T1: { status: "fail", actualMs: 25000, budgetMs: 20000, source: "test" },
          T2: { status: "pass", actualMs: 20000, budgetMs: 25000, source: "test" },
          T3: { status: "pass", actualMs: 1500, budgetMs: 2000, source: "test" },
          T4: { status: "pass", actualMs: 1800, budgetMs: 2000, source: "test" },
          T5: { status: "pass", actualMs: 800, budgetMs: 1000, source: "test" },
        },
      }),
    );

    const result = runAssert(summaryPath, { HVSC_ANDROID_BUDGET_ENFORCE: "1" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("T1");
    expect(result.stderr).toContain("FAILED");
  });

  it("fails when enforced and a target is unmeasured", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        loops: 3,
        warmup: 1,
        targetEvidence: {
          T1: { status: "unmeasured", actualMs: null, budgetMs: 20000, source: "test" },
          T2: { status: "pass", actualMs: 20000, budgetMs: 25000, source: "test" },
          T3: { status: "pass", actualMs: 1500, budgetMs: 2000, source: "test" },
          T4: { status: "pass", actualMs: 1800, budgetMs: 2000, source: "test" },
          T5: { status: "pass", actualMs: 800, budgetMs: 1000, source: "test" },
        },
      }),
    );

    const result = runAssert(summaryPath, { HVSC_ANDROID_BUDGET_ENFORCE: "1" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("T1");
    expect(result.stderr).toContain("unmeasured");
  });

  it("passes when enforced and all targets pass", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        loops: 3,
        warmup: 1,
        targetEvidence: {
          T1: { status: "pass", actualMs: 15000, budgetMs: 20000, source: "test" },
          T2: { status: "pass", actualMs: 20000, budgetMs: 25000, source: "test" },
          T3: { status: "pass", actualMs: 1500, budgetMs: 2000, source: "test" },
          T4: { status: "pass", actualMs: 1800, budgetMs: 2000, source: "test" },
          T5: { status: "pass", actualMs: 800, budgetMs: 1000, source: "test" },
        },
      }),
    );

    const result = runAssert(summaryPath, { HVSC_ANDROID_BUDGET_ENFORCE: "1" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("enforced");
  });

  it("displays loop and warmup metadata in output", () => {
    const root = createTempRoot();
    const summaryPath = path.join(root, "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        loops: 5,
        warmup: 2,
        targetEvidence: {
          T1: { status: "pass", actualMs: 15000, budgetMs: 20000, source: "test" },
          T2: { status: "pass", actualMs: 20000, budgetMs: 25000, source: "test" },
          T3: { status: "pass", actualMs: 1500, budgetMs: 2000, source: "test" },
          T4: { status: "pass", actualMs: 1800, budgetMs: 2000, source: "test" },
          T5: { status: "pass", actualMs: 800, budgetMs: 1000, source: "test" },
        },
      }),
    );

    const result = runAssert(summaryPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Loops: 5");
    expect(result.stdout).toContain("Warmup: 2");
  });
});
