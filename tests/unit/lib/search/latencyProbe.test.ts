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
});
