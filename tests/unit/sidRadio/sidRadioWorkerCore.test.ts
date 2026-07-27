/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { SidcorrParseError, parseSidcorrTiny } from "@/lib/sidRadio/sidcorrTiny";
import {
  buildReadyStats,
  isWorkerGlobalScope,
  stylePopulationsFromBundle,
  toWorkerErrorMessage,
} from "@/lib/sidRadio/sidRadioWorkerCore";
import { buildDefaultTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

describe("sidRadioWorkerCore", () => {
  it("buildReadyStats parses the bundle and surfaces §9.4 counters", () => {
    const stats = buildReadyStats(buildDefaultTinyFixture(), false);
    expect(stats.fileCount).toBe(3);
    expect(stats.trackCount).toBe(4);
    expect(stats.styleCount).toBe(9);
    expect(stats.edgeCount).toBe(5); // 0←1, 0←2, 1←2, 2←3, 0←3
    expect(stats.memoryEstimateBytes).toBeGreaterThan(0);
    expect(stats.engineThreadIsMain).toBe(false);
  });

  it("propagates engineThreadIsMain from the caller (worker sets it false)", () => {
    expect(buildReadyStats(buildDefaultTinyFixture(), true).engineThreadIsMain).toBe(true);
  });

  it("counts every style's members from the mask table, empty ones included", () => {
    // Masks in the fixture: bit 0 on ordinals 0+1, bit 1 on ordinal 2, bit 2 on
    // ordinals 1+3 — and nothing at all in the remaining six styles.
    expect(stylePopulationsFromBundle(parseSidcorrTiny(buildDefaultTinyFixture()))).toEqual({
      fast_paced: 2,
      slow_ambient: 1,
      melodic: 2,
      experimental: 0,
      nostalgic: 0,
      composer_focus: 0,
      era_explorer: 0,
      deep_discovery: 0,
      theme_hunter: 0,
    });
  });

  it("surfaces the populations on the ready message so the launcher can read them", () => {
    const { stylePopulations } = buildReadyStats(buildDefaultTinyFixture(), false);
    expect(stylePopulations.fast_paced).toBe(2);
    expect(stylePopulations.theme_hunter).toBe(0);
  });

  it("throws a typed parse error on a malformed bundle", () => {
    const bad = new ArrayBuffer(8);
    expect(() => buildReadyStats(bad, false)).toThrow(SidcorrParseError);
  });

  it("maps errors to a typed worker error message (never throws past the boundary)", () => {
    expect(toWorkerErrorMessage(new SidcorrParseError("magic", "bad magic"))).toEqual({
      type: "error",
      code: "magic",
      message: "bad magic",
    });
    expect(toWorkerErrorMessage(new Error("boom"))).toEqual({
      type: "error",
      code: "worker-error",
      message: "boom",
    });
  });

  it("reports it is not a worker global scope under the test runner", () => {
    expect(isWorkerGlobalScope()).toBe(false);
  });
});
