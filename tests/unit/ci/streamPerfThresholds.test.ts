/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the committed streaming performance thresholds (spec §16/§21): the config must stay
 * well-formed and internally consistent, and the hard latency gate must not be silently widened
 * above the spec's 30 ms budget. A malformed or weakened config fails the build here.
 */
describe("committed stream perf thresholds", () => {
  const cfg = JSON.parse(readFileSync(resolve(process.cwd(), "ci/perf/stream-perf-thresholds.json"), "utf8"));

  it("carries the full measurement metadata the spec requires (§16)", () => {
    for (const section of ["latencyDrift", "hostBenchmark", "deviceCpu"]) {
      expect(cfg[section]).toBeTruthy();
      expect(typeof cfg[section].profile).toBe("string");
      expect(typeof cfg[section].runner).toBe("string");
      expect(typeof cfg[section].aggregation).toBe("string");
      expect(cfg[section].thresholds).toBeTruthy();
    }
  });

  it("keeps the hard latency budget at or below the spec's 30 ms and a consistent window structure", () => {
    const d = cfg.latencyDrift.thresholds;
    expect(d.maxRollingP99Ms).toBeLessThanOrEqual(30); // §16.1 — never widened past the budget
    expect(d.rollingWindowMs).toBe(60000); // one-minute rolling window (§7)
    expect(d.compareWindowMs).toBe(300000); // five-minute end windows (§7)
    expect(d.maxWindowDeltaMs).toBeLessThanOrEqual(2); // §7 — final 5-min p99 within 2 ms of the first
    expect(d.maxSlopeMsPerMin).toBeGreaterThan(0);
  });

  it("keeps the zero-tolerance audio + video gates at zero (§16.2/§16.3)", () => {
    const a = cfg.audioContinuity.thresholds;
    expect(a.audioCallbackUnderruns).toBe(0);
    expect(a.applicationInducedAudioLoss).toBe(0);
    expect(a.unexplainedAudioGaps).toBe(0);
    expect(a.staleSessionAudioSamples).toBe(0);
    expect(cfg.videoSlots.thresholds.unexplainedMissingPresentationSlots).toBe(0);
  });
});
