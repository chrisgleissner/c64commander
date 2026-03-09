/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdbSerialMock = vi.fn();
const resolvePreferredPhysicalTestDeviceSerialMock = vi.fn();
const runPreflightMock = vi.fn();
const runCaseMock = vi.fn();

vi.mock("../src/deviceRegistry.js", () => ({
  resolveAdbSerial: resolveAdbSerialMock,
  resolvePreferredPhysicalTestDeviceSerial: resolvePreferredPhysicalTestDeviceSerialMock,
}));

vi.mock("../src/preflight.js", () => ({
  runPreflight: runPreflightMock,
}));

vi.mock("../src/validation/runner.js", () => ({
  runCase: runCaseMock,
}));

vi.mock("../src/validation/cases/index.js", () => ({
  ALL_CASES: [{ caseId: "AF-LAUNCH-SHELL-001", id: "AF-LAUNCH-SHELL-001", name: "Launch shell" }],
}));

describe("full app coverage executor", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env["ANDROID_SERIAL"];
    delete process.env["C64U_HOST"];
  });

  it("parses the feature matrix JSON block and validates prompt existence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-fac-parse-"));
    const matrixPath = path.join(tempRoot, "matrix.md");
    const promptPath = path.join(tempRoot, "prompt.md");
    await writeFile(matrixPath, '```json\n[{"id":"F001","prompt":"prompt.md"}]\n```', "utf-8");
    await writeFile(promptPath, "# prompt", "utf-8");

    const { assertPromptFileExists, parseFeatureMatrix, toFeatureResult } =
      await import("../src/fullAppCoverageExecutor.js");

    try {
      await expect(parseFeatureMatrix(matrixPath)).resolves.toEqual([{ id: "F001", prompt: "prompt.md" }]);
      await writeFile(matrixPath, "# no json block", "utf-8");
      await expect(parseFeatureMatrix(matrixPath)).rejects.toThrow(/Unable to locate machine-readable JSON block/);
      await writeFile(matrixPath, "```json\n{}\n```", "utf-8");
      await expect(parseFeatureMatrix(matrixPath)).rejects.toThrow(/is not an array/);
      await expect(assertPromptFileExists(promptPath)).resolves.toBeUndefined();
      await expect(assertPromptFileExists(path.join(tempRoot, "missing.md"))).rejects.toThrow(/Prompt file missing/);
      expect(toFeatureResult({ outcome: "pass" } as { outcome: "pass" | "fail" })).toBe("PASS");
      expect(toFeatureResult({ outcome: "fail" } as { outcome: "pass" | "fail" })).toBe("FAIL");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes manifest and summary for mapped and blocked features", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-fac-main-"));
    const docsRoot = path.join(tempRoot, "doc/testing/agentic-tests/full-app-coverage");
    const runsRoot = path.join(docsRoot, "runs");
    await mkdir(docsRoot, { recursive: true });
    await writeFile(
      path.join(docsRoot, "feature-status-matrix.md"),
      '```json\n[{"id":"F001","prompt":"prompt-1.md"},{"id":"F999","prompt":"prompt-2.md"}]\n```',
      "utf-8",
    );
    await writeFile(path.join(docsRoot, "prompt-1.md"), "# prompt 1", "utf-8");
    await writeFile(path.join(docsRoot, "prompt-2.md"), "# prompt 2", "utf-8");
    process.chdir(tempRoot);

    resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-1");
    runPreflightMock.mockResolvedValue({
      ready: true,
      checks: [{ name: "adb", status: "pass", detail: "ok" }],
    });
    runCaseMock.mockResolvedValue({
      runId: "run-1",
      artifactDir: "/tmp/run-1",
      outcome: "pass",
    });

    const { main } = await import("../src/fullAppCoverageExecutor.js");

    try {
      await main();
      const manifestName = (await readdir(runsRoot)).find((name) => name.endsWith(".json"));
      expect(manifestName).toBeDefined();
      const manifest = JSON.parse(await readFile(path.join(runsRoot, manifestName!), "utf-8"));
      expect(manifest.items).toHaveLength(2);
      expect(manifest.items[0].result).toBe("PASS");
      expect(manifest.items[1].result).toBe("BLOCKED");
      expect(runCaseMock).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks mapped features when the registry entry is missing and fails on preflight errors", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-fac-preflight-"));
    const docsRoot = path.join(tempRoot, "doc/testing/agentic-tests/full-app-coverage");
    const runsRoot = path.join(docsRoot, "runs");
    await mkdir(docsRoot, { recursive: true });
    await writeFile(
      path.join(docsRoot, "feature-status-matrix.md"),
      '```json\n[{"id":"F002","prompt":"prompt-1.md"}]\n```',
      "utf-8",
    );
    await writeFile(path.join(docsRoot, "prompt-1.md"), "# prompt 1", "utf-8");
    process.chdir(tempRoot);

    resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-1");
    runPreflightMock.mockResolvedValue({
      ready: true,
      checks: [{ name: "adb", status: "pass", detail: "ok" }],
    });

    const { main, resolveWorkspaceRoot } = await import("../src/fullAppCoverageExecutor.js");

    try {
      expect(resolveWorkspaceRoot()).toBe(tempRoot);
      await main();
      const manifestName = (await readdir(runsRoot)).find((name) => name.endsWith(".json"));
      const manifest = JSON.parse(await readFile(path.join(runsRoot, manifestName!), "utf-8"));
      expect(manifest.items[0].result).toBe("BLOCKED");
      expect(manifest.items[0].reason).toContain("missing from validation case registry");

      runPreflightMock.mockResolvedValueOnce({
        ready: false,
        checks: [{ name: "adb", status: "fail", detail: "missing" }],
      });
      await expect(main()).rejects.toThrow(/Preflight failed for full-app coverage executor: adb: missing/);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
