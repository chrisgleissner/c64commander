/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS_PATH, assertSidRadioPerf, resolveMetric } from "../../../scripts/assert-sid-radio-perf.mjs";

const thresholds = () => JSON.parse(readFileSync(DEFAULT_THRESHOLDS_PATH, "utf8"));

const goodStats = {
  bundleLoadMs: 130,
  reverseIndexMs: 14,
  firstCandidateMs: 120,
  lastRefillMs: 40,
  refillMainThreadMaxMs: 6,
  skipToLaunchMs: 250,
  tracksAutoAdvanced: 32,
  engineThreadIsMain: false,
  memoryEstimateBytes: 5_247_024,
};

describe("assert-sid-radio-perf", () => {
  it("resolves a composite metric (a+b)", () => {
    expect(resolveMetric({ bundleLoadMs: 130, reverseIndexMs: 14 }, "bundleLoadMs+reverseIndexMs")).toBe(144);
  });

  it("passes stats within all pinned budgets", () => {
    const result = assertSidRadioPerf(goodStats, thresholds());
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  it("fails a cold-load regression (max bound)", () => {
    const result = assertSidRadioPerf({ ...goodStats, bundleLoadMs: 1600 }, thresholds());
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.name)).toContain("coldLoadMs");
  });

  it("fails when the engine ran on the main thread (equals bound)", () => {
    const result = assertSidRadioPerf({ ...goodStats, engineThreadIsMain: true }, thresholds());
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.name)).toContain("engineThreadIsMain");
  });

  it("fails a continuity shortfall (min bound)", () => {
    const result = assertSidRadioPerf({ ...goodStats, tracksAutoAdvanced: 12 }, thresholds());
    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.name)).toContain("tracksAutoAdvanced");
  });

  it("skips (does not fail) metrics missing from the stats blob", () => {
    const result = assertSidRadioPerf(
      { bundleLoadMs: 100, reverseIndexMs: 10, engineThreadIsMain: false },
      thresholds(),
    );
    expect(result.skipped.length).toBeGreaterThan(0);
    // Present metrics still pass.
    expect(result.failures).toEqual([]);
  });
});
