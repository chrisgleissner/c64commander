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
  // Track B / LE3 local-engine budgets (§12.6).
  renderMsPerSec: 60,
  audioUnderruns: 0,
  engineSwitchMs: 900,
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

  it("asserts the Local engine budgets (§12.6, Track B / LE3)", () => {
    // A render-cost regression → renderMsPerSec (max bound). Derived from the
    // pinned value rather than hardcoded: the bound legitimately moved when the
    // engine was changed from SIDLite to reSIDfp, and a literal here silently
    // stopped exercising the failure path.
    const renderBound = thresholds().localEngine.renderMsPerSec.pinned;
    const slow = assertSidRadioPerf({ ...goodStats, renderMsPerSec: renderBound + 1 }, thresholds());
    expect(slow.passed).toBe(false);
    expect(slow.failures.map((f) => f.name)).toContain("renderMsPerSec");

    // Any audible gap over the soak → audioUnderruns regression.
    const gaps = assertSidRadioPerf({ ...goodStats, audioUnderruns: 2 }, thresholds());
    expect(gaps.passed).toBe(false);
    expect(gaps.failures.map((f) => f.name)).toContain("audioUnderruns");

    // A sluggish engine switch → engineSwitchMs regression.
    const slowSwitch = assertSidRadioPerf({ ...goodStats, engineSwitchMs: 2000 }, thresholds());
    expect(slowSwitch.passed).toBe(false);
    expect(slowSwitch.failures.map((f) => f.name)).toContain("engineSwitchMs");
  });

  it("has internally-consistent pinned budgets (recorded measurements within bounds)", () => {
    // A host gate independent of any device run: every recorded `measured.value`
    // in the thresholds file must already satisfy its own pinned budget, across
    // both the SID Radio and Local engine groups. Nobody can pin a budget that
    // the recorded measurement already violates (spec §9.2).
    const doc = thresholds();
    for (const group of [doc.thresholds, doc.localEngine]) {
      for (const [name, spec] of Object.entries<Record<string, unknown>>(group)) {
        const measured = (spec as { measured?: { value?: number | boolean | null } }).measured?.value;
        if (measured === undefined || measured === null) continue;
        const stats = { [(spec as { metric: string }).metric]: measured };
        const result = assertSidRadioPerf(stats, doc);
        expect(
          result.failures.map((f) => f.name),
          `pinned budget ${name} violated by its own measurement`,
        ).not.toContain(name);
      }
    }
  });

  // Absent parts used to coerce to 0, so a composite budget with neither part measured resolved to
  // a sum of 0 that satisfies every max bound - a fabricated measurement, not a skip.
  it("treats a composite metric with a missing part as unmeasured rather than as zero", () => {
    expect(resolveMetric({ bundleLoadMs: 100 }, "bundleLoadMs+reverseIndexMs")).toBeUndefined();
    expect(resolveMetric({}, "bundleLoadMs+reverseIndexMs")).toBeUndefined();
    expect(resolveMetric({ bundleLoadMs: 100, reverseIndexMs: 10 }, "bundleLoadMs+reverseIndexMs")).toBe(110);
  });

  // A stats blob whose metric paths all moved reported "PASS - 0 checked" and exited 0, so a
  // renamed measurement would have retired the whole gate silently.
  it("does not pass a blob in which nothing at all was measured", () => {
    const result = assertSidRadioPerf({}, thresholds());
    expect(result.checked).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(false);
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
