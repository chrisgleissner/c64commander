import { describe, expect, it } from "vitest";

import {
  buildDiagnosticsAnalyticsSeed,
  DIAGNOSTICS_HEALTH_HISTORY_SAMPLE_COUNT,
  DIAGNOSTICS_LATENCY_SAMPLE_COUNT,
} from "../../../playwright/visualSeeds";

describe("buildDiagnosticsAnalyticsSeed", () => {
  it("produces dense diagnostics history and latency samples for screenshot seeding", () => {
    const seed = buildDiagnosticsAnalyticsSeed();
    const historyMinutesAgo = seed.healthHistory.map((entry) => entry.minutesAgo);
    const latencyBuckets = new Set(seed.latencySamples.map((sample) => Math.floor(sample.timestampMs / 30_000)));

    expect(seed.healthHistory).toHaveLength(DIAGNOSTICS_HEALTH_HISTORY_SAMPLE_COUNT);
    expect(seed.latencySamples).toHaveLength(DIAGNOSTICS_LATENCY_SAMPLE_COUNT);
    expect(historyMinutesAgo[0]).toBe(240);
    expect(historyMinutesAgo.at(-1)).toBe(0);
    expect(
      historyMinutesAgo.every((minutesAgo, index, values) => index === 0 || values[index - 1]! - minutesAgo === 2),
    ).toBe(true);
    expect(latencyBuckets.size).toBeGreaterThanOrEqual(10);
  });
});
