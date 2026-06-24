/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import { coverageFromRouteFingerprints, parseDiscoverRoutesArgs } from "../src/cta/discoverRoutes.js";

describe("route discovery CLI", () => {
  afterEach(() => {
    delete process.env.ANDROID_SERIAL;
  });

  it("parses route discovery flags", () => {
    const args = parseDiscoverRoutesArgs([
      "--serial",
      "9B0",
      "--target",
      "c64u",
      "--case",
      "CASE-1",
      "--artifact-dir",
      "/tmp/routes",
      "--start-app",
      "--settle-ms",
      "2500",
      "--max-scrolls",
      "4",
    ]);

    expect(args).toEqual({
      serial: "9B0",
      target: "c64u",
      caseId: "CASE-1",
      artifactDir: "/tmp/routes",
      startApp: true,
      settleMs: 2500,
      maxScrolls: 4,
    });
  });

  it("uses ANDROID_SERIAL and rejects invalid targets", () => {
    process.env.ANDROID_SERIAL = "env-serial";

    expect(parseDiscoverRoutesArgs([]).serial).toBe("env-serial");
    expect(() => parseDiscoverRoutesArgs(["--target", "bad"])).toThrow(/Invalid --target/);
  });
});

describe("route discovery coverage", () => {
  it("marks discovered route controls as calibration-only", () => {
    const records = coverageFromRouteFingerprints(
      "run-1",
      { route: "/play", label: "Play", keyCode: 9, featureId: "F010" },
      ["lbl|/play||button|add files"],
    );

    expect(records).toEqual([
      {
        ctaId: "F010.C001",
        featureId: "F010",
        route: "/play",
        label: "add files",
        status: "CALIBRATION_ONLY",
        inputMethod: "none",
        runId: "run-1",
        notes: "Runtime discovery fingerprint: lbl|/play||button|add files",
      },
    ]);
  });
});
