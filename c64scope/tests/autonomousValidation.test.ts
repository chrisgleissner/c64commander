/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdbSerialMock = vi.fn();
const resolvePreferredPhysicalTestDeviceSerialMock = vi.fn();
const runPreflightMock = vi.fn();
const generateReportMock = vi.fn();
const collectHardwareInfoMock = vi.fn();
const runCaseMock = vi.fn();

vi.mock("../src/deviceRegistry.js", () => ({
  resolveAdbSerial: resolveAdbSerialMock,
  resolvePreferredPhysicalTestDeviceSerial: resolvePreferredPhysicalTestDeviceSerialMock,
}));

vi.mock("../src/preflight.js", () => ({
  runPreflight: runPreflightMock,
}));

vi.mock("../src/validation/report.js", () => ({
  generateReport: generateReportMock,
}));

vi.mock("../src/validation/runner.js", () => ({
  collectHardwareInfo: collectHardwareInfoMock,
  runCase: runCaseMock,
}));

vi.mock("../src/validation/cases/index.js", () => ({
  ALL_CASES: [
    {
      id: "AF-001",
      name: "Product Case",
      caseId: "AF-001",
      featureArea: "Play",
      route: "/play",
      validationTrack: "product",
      safetyClass: "read-only",
      expectedOutcome: "pass",
      oracleClasses: ["UI", "REST-visible state"],
    },
    {
      id: "CAL-001",
      name: "Calibration Case",
      caseId: "CAL-001",
      featureArea: "Config",
      route: "/config",
      validationTrack: "calibration",
      safetyClass: "guarded-mutation",
      expectedOutcome: "fail",
      oracleClasses: ["UI", "A/V signal"],
    },
  ],
}));

describe("autonomous validation", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env["ANDROID_SERIAL"];
    delete process.env["C64U_HOST"];
    delete process.env["REPEAT"];
    delete process.env["VALIDATION_TRACK"];
  });

  it("parses track modes", async () => {
    const { parseTrackMode } = await import("../src/autonomousValidation.js");
    expect(parseTrackMode(undefined)).toBe("product");
    expect(parseTrackMode(" calibration ")).toBe("calibration");
    expect(parseTrackMode("ALL")).toBe("all");
    expect(() => parseTrackMode("bad")).toThrow(/Invalid VALIDATION_TRACK/);
  });

  it("stops early when preflight is not ready", async () => {
    resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-1");
    runPreflightMock.mockResolvedValue({
      ready: false,
      checks: [{ name: "adb", status: "fail", detail: "missing" }],
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { main } = await import("../src/autonomousValidation.js");
    process.exitCode = undefined;

    try {
      await main();
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("\nPreflight FAILED. Cannot proceed.");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("runs selected cases and writes report artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-auto-"));
    process.chdir(tempRoot);

    resolveAdbSerialMock.mockResolvedValue("serial-2");
    runPreflightMock.mockResolvedValue({
      ready: true,
      checks: [{ name: "adb", status: "pass", detail: "ok" }],
    });
    collectHardwareInfoMock.mockResolvedValue({
      hwModel: "Phone",
      hwType: "hw",
      hwChars: "default",
      osVersion: "14",
      c64uInfo: { product: "Ultimate 64", firmware_version: "1.0", hostname: "c64u", unique_id: "abc" },
    });
    generateReportMock.mockReturnValue("# report");
    runCaseMock.mockResolvedValue({
      caseId: "AF-001",
      caseName: "Product Case",
      featureArea: "Play",
      route: "/play",
      validationTrack: "product",
      runId: "run-1",
      outcome: "pass",
      failureClass: "inconclusive",
      oracleClasses: ["UI", "REST-visible state"],
      artifactDir: "/tmp/run-1",
      artifacts: ["session.json", "llm-decision-trace.json", "hardware-proof.json"],
      explorationTrace: {
        routeDiscovery: [],
        decisionLog: [],
        safetyBudget: "read-only",
        oracleSelection: [],
        recoveryActions: [],
      },
      durationMs: 100,
    });
    process.env["ANDROID_SERIAL"] = "serial-2";
    process.env["VALIDATION_TRACK"] = "product";

    const { main } = await import("../src/autonomousValidation.js");

    try {
      await main();
      expect(runCaseMock).toHaveBeenCalledTimes(1);
      expect(generateReportMock).toHaveBeenCalledTimes(1);
      expect(await readFile(path.join(tempRoot, "c64scope/artifacts/validation-report.md"), "utf-8")).toBe("# report");
      expect(
        JSON.parse(await readFile(path.join(tempRoot, "c64scope/artifacts/validation-results.json"), "utf-8")),
      ).toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("marks validation incomplete when a case errors or mismatches the expected outcome", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-auto-incomplete-"));
    process.chdir(tempRoot);

    resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-3");
    runPreflightMock.mockResolvedValue({
      ready: true,
      checks: [{ name: "adb", status: "pass", detail: "ok" }],
    });
    collectHardwareInfoMock.mockResolvedValue({
      hwModel: "Phone",
      hwType: "hw",
      hwChars: "default",
      osVersion: "14",
      c64uInfo: { product: "Ultimate 64", firmware_version: "1.0", hostname: "c64u", unique_id: "abc" },
    });
    generateReportMock.mockReturnValue("# report");
    runCaseMock.mockRejectedValue(new Error("case exploded"));
    process.env["VALIDATION_TRACK"] = "product";
    process.env["REPEAT"] = "2";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { main } = await import("../src/autonomousValidation.js");
    process.exitCode = undefined;

    try {
      await main();
      expect(runCaseMock).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("  ✗ ERROR: case exploded");
      expect(errorSpy).toHaveBeenCalledWith("\n  VALIDATION INCOMPLETE: 2 case(s) had unexpected outcomes.");
      expect(
        JSON.parse(await readFile(path.join(tempRoot, "c64scope/artifacts/validation-results.json"), "utf-8")),
      ).toHaveLength(2);
    } finally {
      errorSpy.mockRestore();
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
