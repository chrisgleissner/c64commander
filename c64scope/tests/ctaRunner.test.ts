/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import { coverageFromFingerprints, parseCtaRunnerArgs } from "../src/cta/runner.js";
import { getScreenSize } from "../src/cta/uiHelpers.js";

describe("CTA runner CLI", () => {
  afterEach(() => {
    delete process.env.ANDROID_SERIAL;
  });

  it("parses runner flags with defaults", () => {
    const args = parseCtaRunnerArgs([
      "--device",
      "9B0",
      "--target=u64",
      "--discover-only",
      "--routes",
      "/docs,/settings",
      "--case",
      "CASE-1",
      "--seed",
      "123",
      "--keypad",
      "--touch-parity",
      "--risk-level=R1",
      "--artifact-dir",
      "/tmp/cta",
      "--retain-success",
      "2",
      "--verbose",
    ]);

    expect(args).toEqual({
      device: "9B0",
      target: "u64",
      discoverOnly: true,
      routes: ["/docs", "/settings"],
      caseId: "CASE-1",
      seed: 123,
      keypad: true,
      touchParity: true,
      riskLevel: "R1",
      artifactDir: "/tmp/cta",
      retainSuccess: 2,
      verbose: true,
    });
  });

  it("uses ANDROID_SERIAL and rejects invalid targets", () => {
    process.env.ANDROID_SERIAL = "env-serial";

    expect(parseCtaRunnerArgs([]).device).toBe("env-serial");
    expect(() => parseCtaRunnerArgs(["--target=bad"])).toThrow(/Invalid --target/);
  });
});

describe("CTA runner coverage records", () => {
  it("marks discovery output as calibration-only coverage", () => {
    const records = coverageFromFingerprints("run-1", "/docs", ["lbl|/docs||button|getting started"]);

    expect(records).toEqual([
      {
        ctaId: "F022.C001",
        featureId: "F022",
        route: "/docs",
        label: "getting started",
        status: "CALIBRATION_ONLY",
        inputMethod: "none",
        runId: "run-1",
        notes: "Runtime discovery fingerprint: lbl|/docs||button|getting started",
      },
    ]);
  });
});

describe("CTA hierarchy utilities", () => {
  it("throws instead of guessing when root bounds are unavailable", () => {
    expect(() => getScreenSize("<hierarchy><node /></hierarchy>")).toThrow(/screen size/);
  });
});
