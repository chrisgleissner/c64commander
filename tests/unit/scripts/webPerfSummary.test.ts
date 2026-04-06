import { describe, expect, it } from "vitest";

import { summarizeScenarioIterations, summarizeSecondaryIterations } from "../../../scripts/hvsc/webPerfSummary.mjs";

describe("webPerfSummary", () => {
  it("summarizes the legacy secondary lane metrics", () => {
    const summary = summarizeSecondaryIterations([
      {
        metrics: {
          browseLoadSnapshotMs: 8,
          browseInitialQueryMs: 120,
          browseSearchQueryMs: 22,
          playbackLoadSidMs: 4,
        },
      },
      {
        metrics: {
          browseLoadSnapshotMs: 12,
          browseInitialQueryMs: 150,
          browseSearchQueryMs: 18,
          playbackLoadSidMs: 6,
        },
      },
    ]);

    expect(summary.browseLoadSnapshotMs.p50).toBe(8);
    expect(summary.browseInitialQueryMs.p95).toBe(150);
    expect(summary.playbackLoadSidMs.samples).toEqual([4, 6]);
  });

  it("builds scenario and target summaries for S1-S11 iterations", () => {
    const summary = summarizeScenarioIterations(
      [
        {
          scenarios: [
            { scenario: "S1-download", wallClockMs: 10_000, timings: [{ scope: "download", durationMs: 9_500 }] },
            {
              scenario: "S2-ingest",
              wallClockMs: 21_000,
              timings: [
                { scope: "ingest:extract", durationMs: 8_000 },
                { scope: "ingest:index-build", durationMs: 9_000 },
              ],
            },
            { scenario: "S3-enter-hvsc-root", wallClockMs: 400, timings: [{ scope: "browse:query", durationMs: 120 }] },
            { scenario: "S4-traverse-down", wallClockMs: 700, timings: [{ scope: "browse:query", durationMs: 260 }] },
            { scenario: "S5-traverse-up", wallClockMs: 650, timings: [{ scope: "browse:query", durationMs: 240 }] },
            {
              scenario: "S8-filter-high-match",
              wallClockMs: 320,
              timings: [{ scope: "playlist:filter", durationMs: 250 }],
            },
            {
              scenario: "S9-filter-zero-match",
              wallClockMs: 350,
              timings: [{ scope: "playlist:filter", durationMs: 270 }],
            },
            {
              scenario: "S10-filter-low-match",
              wallClockMs: 300,
              timings: [{ scope: "playlist:filter", durationMs: 220 }],
            },
            {
              scenario: "S11-playback-start",
              wallClockMs: 480,
              timings: [{ scope: "playback:first-audio", durationMs: 410 }],
            },
          ],
        },
        {
          scenarios: [
            { scenario: "S1-download", wallClockMs: 12_000, timings: [{ scope: "download", durationMs: 11_000 }] },
            {
              scenario: "S2-ingest",
              wallClockMs: 24_000,
              timings: [
                { scope: "ingest:extract", durationMs: 9_000 },
                { scope: "ingest:index-build", durationMs: 10_500 },
              ],
            },
            {
              scenario: "S3-enter-hvsc-root",
              wallClockMs: 450,
              timings: [{ scope: "browse:load-snapshot", durationMs: 55 }],
            },
            { scenario: "S4-traverse-down", wallClockMs: 800, timings: [{ scope: "browse:query", durationMs: 290 }] },
            { scenario: "S5-traverse-up", wallClockMs: 720, timings: [{ scope: "browse:query", durationMs: 250 }] },
            {
              scenario: "S8-filter-high-match",
              wallClockMs: 410,
              timings: [{ scope: "playlist:filter", durationMs: 280 }],
            },
            {
              scenario: "S9-filter-zero-match",
              wallClockMs: 390,
              timings: [{ scope: "playlist:filter", durationMs: 290 }],
            },
            {
              scenario: "S10-filter-low-match",
              wallClockMs: 330,
              timings: [{ scope: "playlist:filter", durationMs: 230 }],
            },
            {
              scenario: "S11-playback-start",
              wallClockMs: 520,
              timings: [{ scope: "playback:first-audio", durationMs: 430 }],
            },
          ],
        },
      ],
      { evidenceClass: "full-scale" },
    );

    expect(summary.scenarioCoverage).toContainEqual({ scenario: "S1-download", sampleCount: 2 });
    expect(summary.scenarioSummaries["S1-download"].wallClockMs.p95).toBe(12_000);
    expect(summary.scenarioSummaries["S11-playback-start"].scopeMetrics["playback:first-audio"].p50).toBe(410);
    expect(summary.targetEvidence.T1.status).toBe("pass");
    expect(summary.targetEvidence.T2.status).toBe("pass");
    expect(summary.targetEvidence.T5.actualMs).toBe(520);
  });

  it("treats negative wall clock values as unmeasured", () => {
    const summary = summarizeScenarioIterations(
      [
        {
          scenarios: [
            { scenario: "S1-download", wallClockMs: -1, timings: [] },
            { scenario: "S2-ingest", wallClockMs: 200, timings: [] },
            { scenario: "S3-enter-hvsc-root", wallClockMs: 300, timings: [] },
            { scenario: "S11-playback-start", wallClockMs: 150, timings: [] },
          ],
        },
      ],
      { evidenceClass: "full-scale" },
    );

    expect(summary.targetEvidence.T1.status).toBe("unmeasured");
    expect(summary.targetEvidence.T1.actualMs).toBeNull();
    expect(summary.targetEvidence.T2.status).toBe("pass");
    expect(summary.targetEvidence.T2.actualMs).toBe(200);
  });

  it("marks fixture-backed scenario runs as unmeasured target evidence", () => {
    const summary = summarizeScenarioIterations(
      [
        {
          scenarios: [
            { scenario: "S1-download", wallClockMs: 5_000, timings: [] },
            { scenario: "S2-ingest", wallClockMs: 6_000, timings: [] },
            { scenario: "S3-enter-hvsc-root", wallClockMs: 300, timings: [] },
            { scenario: "S11-playback-start", wallClockMs: 150, timings: [] },
          ],
        },
      ],
      { evidenceClass: "fixture" },
    );

    expect(summary.evidenceClass).toBe("fixture");
    expect(summary.scenarioSummaries["S1-download"].wallClockMs.p95).toBe(5_000);
    expect(summary.targetEvidence.T1.status).toBe("unmeasured");
    expect(summary.targetEvidence.T1.reason).toMatch(/mechanism proof only/i);
    expect(summary.targetEvidence.T5.status).toBe("unmeasured");
  });

  it("marks hybrid real-download runs as unmeasured target evidence", () => {
    const summary = summarizeScenarioIterations(
      [
        {
          scenarios: [
            { scenario: "S1-download", wallClockMs: 40_000, timings: [] },
            { scenario: "S2-ingest", wallClockMs: 50_000, timings: [] },
            { scenario: "S3-enter-hvsc-root", wallClockMs: 200, timings: [] },
          ],
        },
      ],
      { evidenceClass: "hybrid" },
    );

    expect(summary.evidenceClass).toBe("hybrid");
    expect(summary.targetEvidence.T1.status).toBe("unmeasured");
    expect(summary.targetEvidence.T1.reason).toMatch(/real downloads with fixture-backed browse/i);
    expect(summary.targetEvidence.T3.status).toBe("unmeasured");
  });
});
