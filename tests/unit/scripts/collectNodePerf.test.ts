import { describe, expect, it } from "vitest";

import { resolveNodePerfProfile, runNodePerfSuite } from "../../../scripts/hvsc/collect-node-perf";

describe("collect-node-perf", () => {
  it("resolves the manual extended profile with larger scales and sample counts", () => {
    expect(resolveNodePerfProfile("manual-extended")).toEqual(
      expect.objectContaining({
        name: "manual-extended",
        scales: [10_000, 50_000, 100_000, 150_000],
        samples: 24,
      }),
    );
  });

  it("produces a deterministic summary for a tiny smoke-scale run", async () => {
    const summary = await runNodePerfSuite({
      profile: "smoke",
      scales: [100],
      samples: 1,
      warmups: 0,
    });

    expect(summary.suite).toBe("node-hvsc-data-paths");
    expect(summary.profile).toBe("smoke");
    expect(summary.scenarios.length).toBeGreaterThan(5);
    expect(summary.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenario: "build-browse-index", scale: 100 }),
        expect.objectContaining({ scenario: "query-playlist-high-match", scale: 100 }),
      ]),
    );
  });
});
