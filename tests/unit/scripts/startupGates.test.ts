import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const budgetsScript = path.resolve(
  process.cwd(),
  "scripts/startup/assert-startup-budgets.mjs",
);
const hvscScript = path.resolve(
  process.cwd(),
  "scripts/startup/assert-hvsc-startup-safety.mjs",
);

const run = (script: string, filePath: string) =>
  spawnSync(process.execPath, [script, `--file=${filePath}`], {
    encoding: "utf8",
    env: process.env,
  });

const writeSummary = (
  filePath: string,
  overrides: Record<string, unknown> = {},
) => {
  const base = {
    metrics: {
      StartupRequestCount: { p95: 20 },
      StartupConfigCalls: { p95: 10 },
      DuplicateStartupConfigKeyRequests: { p95: 0 },
      TTFSC: { p50: 3000, p95: 6000 },
      StartupBacklogDepth: { p95: 10 },
      UserTriggeredCommandLatencyMs: { p95: 400 },
      HvscStartupDownloads: { p95: 0 },
    },
  };
  writeFileSync(
    filePath,
    JSON.stringify({ ...base, ...overrides }, null, 2),
    "utf8",
  );
};

describe("startup gating scripts", () => {
  it("passes for in-budget startup summary", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "startup-gate-pass-"));
    try {
      const outDir = path.join(root, "ci-artifacts", "startup");
      mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, "startup-baseline.json");
      writeSummary(filePath);

      const budgets = run(budgetsScript, filePath);
      const hvsc = run(hvscScript, filePath);

      expect(budgets.status).toBe(0);
      expect(hvsc.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when startup budget is exceeded", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "startup-gate-fail-"));
    try {
      const outDir = path.join(root, "ci-artifacts", "startup");
      mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, "startup-baseline.json");
      writeSummary(filePath, {
        metrics: {
          StartupRequestCount: { p95: 50 },
          StartupConfigCalls: { p95: 20 },
          DuplicateStartupConfigKeyRequests: { p95: 5 },
          TTFSC: { p50: 7000, p95: 11000 },
          StartupBacklogDepth: { p95: 100 },
          UserTriggeredCommandLatencyMs: { p95: 1500 },
          HvscStartupDownloads: { p95: 0 },
        },
      });

      const budgets = run(budgetsScript, filePath);

      expect(budgets.status).toBe(1);
      expect(budgets.stderr).toContain("exceeded budget");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails HVSC startup safety when startup includes HVSC downloads", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "startup-hvsc-fail-"));
    try {
      const outDir = path.join(root, "ci-artifacts", "startup");
      mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, "startup-baseline.json");
      writeSummary(filePath, {
        metrics: {
          StartupRequestCount: { p95: 10 },
          StartupConfigCalls: { p95: 2 },
          DuplicateStartupConfigKeyRequests: { p95: 0 },
          TTFSC: { p50: 2000, p95: 3500 },
          StartupBacklogDepth: { p95: 5 },
          UserTriggeredCommandLatencyMs: { p95: 350 },
          HvscStartupDownloads: { p95: 1 },
        },
      });

      const hvsc = run(hvscScript, filePath);

      expect(hvsc.status).toBe(1);
      expect(hvsc.stderr).toContain("HVSC startup safety failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
