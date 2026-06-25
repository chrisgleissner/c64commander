/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import { buildKeypadCanaryResult, KEYCODES, summarizeKeypadCanary } from "../src/cta/keypadCanary.js";
import { parseKeypadCanaryArgs } from "../src/cta/keypadCanaryRunner.js";

describe("CTA keypad canary CLI", () => {
  afterEach(() => {
    delete process.env.ANDROID_SERIAL;
  });

  it("parses keypad canary flags with defaults", () => {
    const args = parseKeypadCanaryArgs([
      "--serial",
      "9B0",
      "--target=u64",
      "--case",
      "CASE-2",
      "--artifact-dir",
      "/tmp/keypad",
      "--start-app",
      "--settle-ms",
      "25",
      "--include-dpad",
    ]);

    expect(args).toEqual({
      serial: "9B0",
      target: "u64",
      caseId: "CASE-2",
      artifactDir: "/tmp/keypad",
      startApp: true,
      settleMs: 25,
      includeDpad: true,
    });
  });

  it("uses ANDROID_SERIAL and rejects invalid values", () => {
    process.env.ANDROID_SERIAL = "env-serial";

    expect(parseKeypadCanaryArgs([])).toMatchObject({
      serial: "env-serial",
      target: "c64u",
      caseId: "CTA-GATE2-KEYPAD-CANARY",
      settleMs: 1200,
      includeDpad: false,
    });
    expect(() => parseKeypadCanaryArgs(["--target=bad"])).toThrow(/Invalid --target/);
    expect(() => parseKeypadCanaryArgs(["--settle-ms=-1"])).toThrow(/Invalid --settle-ms/);
  });
});

describe("CTA keypad canary result evaluation", () => {
  it("passes a step only when all expected markers are present", () => {
    const result = buildKeypadCanaryResult(
      {
        id: "digit-6-docs",
        kind: "tab-shortcut",
        keyName: "6",
        keyCode: KEYCODES.KEY_6,
        expectedText: ["Docs", "Getting Started"],
      },
      '<node text="Docs"/><node content-desc="Getting Started"/>',
      { screenshot: "screenshots/digit-6-docs.png", hierarchy: "hierarchies/digit-6-docs.xml" },
    );

    expect(result.status).toBe("PASS");
    expect(result.missingText).toEqual([]);
  });

  it("reports missing markers as a failed step", () => {
    const result = buildKeypadCanaryResult(
      {
        id: "star-diagnostics",
        kind: "overlay-shortcut",
        keyName: "Star",
        keyCode: KEYCODES.STAR,
        expectedText: ["Diagnostics"],
      },
      '<node text="Docs"/>',
      { screenshot: "screenshots/star-diagnostics.png", hierarchy: "hierarchies/star-diagnostics.xml" },
    );

    expect(result.status).toBe("FAIL");
    expect(result.missingText).toEqual(["Diagnostics"]);
  });

  it("summarizes pass and fail counts", () => {
    const pass = buildKeypadCanaryResult(
      {
        id: "digit-1-home",
        kind: "tab-shortcut",
        keyName: "1",
        keyCode: KEYCODES.KEY_1,
        expectedText: ["Home"],
      },
      '<node text="Home"/>',
      { screenshot: "screenshots/digit-1-home.png", hierarchy: "hierarchies/digit-1-home.xml" },
    );
    const fail = buildKeypadCanaryResult(
      {
        id: "digit-2-play",
        kind: "tab-shortcut",
        keyName: "2",
        keyCode: KEYCODES.KEY_2,
        expectedText: ["Play Files"],
      },
      '<node text="Home"/>',
      { screenshot: "screenshots/digit-2-play.png", hierarchy: "hierarchies/digit-2-play.xml" },
    );

    expect(summarizeKeypadCanary([pass, fail])).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      status: "FAIL",
    });
  });
});
