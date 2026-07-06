/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  clearInputLatencySamples,
  getInputLatencySamples,
  getInputLatencyStats,
  recordInputLatencySample,
  registerRemoteInputLatencyBridge,
} from "@/lib/remoteInput/inputLatency";

describe("inputLatency", () => {
  afterEach(() => {
    clearInputLatencySamples();
    delete window.__c64uRemoteInputLatency;
  });

  it("reports all-zero stats when no samples have been recorded", () => {
    expect(getInputLatencySamples()).toEqual([]);
    expect(getInputLatencyStats()).toEqual({ count: 0, minMs: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0 });
  });

  it("records samples and computes min/max/mean/percentiles over them", () => {
    [10, 20, 30, 40, 50].forEach((latencyMs, index) => recordInputLatencySample(latencyMs, index));

    expect(getInputLatencySamples()).toEqual([
      { latencyMs: 10, atMs: 0 },
      { latencyMs: 20, atMs: 1 },
      { latencyMs: 30, atMs: 2 },
      { latencyMs: 40, atMs: 3 },
      { latencyMs: 50, atMs: 4 },
    ]);

    const stats = getInputLatencyStats();
    expect(stats.count).toBe(5);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(50);
    expect(stats.meanMs).toBe(30);
    expect(stats.p50Ms).toBe(30);
    expect(stats.p95Ms).toBe(50);
  });

  it("evicts the oldest sample once the ring buffer exceeds its capacity", () => {
    for (let i = 0; i < 201; i += 1) recordInputLatencySample(i, i);

    const samples = getInputLatencySamples();
    expect(samples).toHaveLength(200);
    // Sample 0 was pushed first and is the one evicted once the 201st arrives.
    expect(samples[0]).toEqual({ latencyMs: 1, atMs: 1 });
    expect(samples[samples.length - 1]).toEqual({ latencyMs: 200, atMs: 200 });
  });

  it("clears every recorded sample", () => {
    recordInputLatencySample(5, 0);
    clearInputLatencySamples();
    expect(getInputLatencySamples()).toEqual([]);
  });

  it("exposes a read-only bridge on window for e2e tests to read real measured latency", () => {
    registerRemoteInputLatencyBridge();
    recordInputLatencySample(7, 1);

    const bridge = window.__c64uRemoteInputLatency;
    expect(bridge).toBeDefined();
    expect(bridge?.getSamples()).toEqual([{ latencyMs: 7, atMs: 1 }]);
    expect(bridge?.getStats().count).toBe(1);

    bridge?.clear();
    expect(getInputLatencySamples()).toEqual([]);
  });

  it("registers the bridge only once, keeping the same object on repeated calls", () => {
    registerRemoteInputLatencyBridge();
    const first = window.__c64uRemoteInputLatency;
    registerRemoteInputLatencyBridge();
    expect(window.__c64uRemoteInputLatency).toBe(first);
  });
});
