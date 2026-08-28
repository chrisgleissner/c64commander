/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LATENCY_SAMPLE_LIMIT,
  __testing,
  isSearchLatencyProbeEnabled,
  markSearchKeystroke,
  markSearchResultsPainted,
  percentile,
} from "@/lib/search/latencyProbe";

type ProbeWindow = Window & {
  __c64uSearchLatencyProbe?: boolean;
  __c64uSearchLatencySamples?: number[];
  __c64uTestProbeEnabled?: boolean;
};

const probeWindow = window as ProbeWindow;

describe("search latency probe", () => {
  beforeEach(() => {
    __testing.reset();
    delete probeWindow.__c64uSearchLatencyProbe;
    delete probeWindow.__c64uTestProbeEnabled;
  });

  afterEach(() => {
    __testing.reset();
    delete probeWindow.__c64uSearchLatencyProbe;
    delete probeWindow.__c64uTestProbeEnabled;
  });

  /*
   * Off unless something turns it on. Production must not accumulate an array of timings for a
   * measurement nobody asked for.
   */
  it("is off by default and records nothing", () => {
    expect(isSearchLatencyProbeEnabled()).toBe(false);
    markSearchKeystroke();
    markSearchResultsPainted();
    expect(probeWindow.__c64uSearchLatencySamples).toBeUndefined();
  });

  it("records a sample per keystroke once switched on", () => {
    probeWindow.__c64uSearchLatencyProbe = true;
    markSearchKeystroke();
    markSearchResultsPainted();
    markSearchKeystroke();
    markSearchResultsPainted();
    expect(probeWindow.__c64uSearchLatencySamples).toHaveLength(2);
  });

  it("records nothing for a paint with no keystroke before it", () => {
    probeWindow.__c64uSearchLatencyProbe = true;
    markSearchResultsPainted();
    expect(probeWindow.__c64uSearchLatencySamples).toBeUndefined();
  });

  it("records one sample per keystroke, not one per commit that follows it", () => {
    probeWindow.__c64uSearchLatencyProbe = true;
    markSearchKeystroke();
    markSearchResultsPainted();
    markSearchResultsPainted();
    expect(probeWindow.__c64uSearchLatencySamples).toHaveLength(1);
  });

  it("is also on under the app's general test probe flag", () => {
    probeWindow.__c64uTestProbeEnabled = true;
    expect(isSearchLatencyProbeEnabled()).toBe(true);
  });

  it("keeps a bounded number of samples", () => {
    probeWindow.__c64uSearchLatencyProbe = true;
    for (let index = 0; index < LATENCY_SAMPLE_LIMIT + 50; index += 1) {
      markSearchKeystroke();
      markSearchResultsPainted();
    }
    expect(probeWindow.__c64uSearchLatencySamples).toHaveLength(LATENCY_SAMPLE_LIMIT);
  });

  describe("percentile", () => {
    /*
     * Nearest-rank, and the reason the HIL stage takes 120 samples: at 20 the p95 is the 19th of
     * 20, which is one of the two worst observations rather than an estimate of anything.
     */
    it("takes the nearest rank", () => {
      const values = Array.from({ length: 100 }, (_unused, index) => index + 1);
      expect(percentile(values, 0.95)).toBe(95);
      expect(percentile(values, 0.5)).toBe(50);
    });

    it("is the worst value at the top", () => {
      expect(percentile([5, 1, 3], 1)).toBe(5);
    });

    it("is the best value at the bottom", () => {
      expect(percentile([5, 1, 3], 0)).toBe(1);
    });

    it("has no answer with no samples", () => {
      expect(percentile([], 0.95)).toBeNull();
    });
  });
});
