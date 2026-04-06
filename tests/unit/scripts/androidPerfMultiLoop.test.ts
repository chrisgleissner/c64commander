import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { summarizeAndroidBenchmarkArtifacts } from "../../../scripts/hvsc/androidPerfSummary.mjs";

const tempDirs: string[] = [];

const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "android-hvsc-multiloop-"));
  tempDirs.push(root);
  return root;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("multi-loop Android benchmark aggregation", () => {
  it("aggregates smoke snapshots from multiple measured loops into correct p50/p95", () => {
    const snapshots = [
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 300 }],
        metadata: { windowMs: 400 },
      },
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 500 }],
        metadata: { windowMs: 600 },
      },
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 350 }],
        metadata: { windowMs: 450 },
      },
    ];

    const summary = summarizeAndroidBenchmarkArtifacts({
      smokeDir: snapshots,
      telemetryCsvPath: null,
      telemetryMetaPath: null,
      perfettoPath: null,
      perfettoLogPath: null,
    });

    const browse = summary.scenarioSummaries["browse-query"];
    expect(browse.sampleCount).toBe(3);
    expect(browse.scopeMetrics["browse:query"].p50).toBe(350);
    expect(browse.scopeMetrics["browse:query"].p95).toBe(500);
    expect(browse.derivedMetrics.windowMs.p50).toBe(450);
    expect(browse.derivedMetrics.windowMs.p95).toBe(600);
  });

  it("produces target evidence from aggregated multi-scenario multi-loop snapshots", () => {
    const snapshots = [
      // Loop 1
      {
        scenario: "install",
        hvscPerfTimings: [
          { scope: "download", durationMs: 12000 },
          { scope: "ingest:extract", durationMs: 6000 },
          { scope: "ingest:index-build", durationMs: 8000 },
        ],
      },
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 400 }],
        metadata: { windowMs: 500 },
      },
      {
        scenario: "playback-start",
        hvscPerfTimings: [{ scope: "playback:first-audio", durationMs: 700 }],
      },
      {
        scenario: "playlist-filter-high",
        hvscPerfTimings: [{ scope: "playlist:filter", durationMs: 900 }],
        metadata: {
          playlistSize: 6000,
          queryEngine: "repository",
          playlistOwnership: "react-state",
          feedbackKind: "result",
          feedbackVisibleWithinMs: 900,
        },
      },
      // Loop 2
      {
        scenario: "install",
        hvscPerfTimings: [
          { scope: "download", durationMs: 13500 },
          { scope: "ingest:extract", durationMs: 7000 },
          { scope: "ingest:index-build", durationMs: 9000 },
        ],
      },
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 350 }],
        metadata: { windowMs: 480 },
      },
      {
        scenario: "playback-start",
        hvscPerfTimings: [{ scope: "playback:first-audio", durationMs: 650 }],
      },
      {
        scenario: "playlist-filter-high",
        hvscPerfTimings: [{ scope: "playlist:filter", durationMs: 850 }],
        metadata: {
          playlistSize: 6000,
          queryEngine: "repository",
          playlistOwnership: "react-state",
          feedbackKind: "result",
          feedbackVisibleWithinMs: 850,
        },
      },
    ];

    const summary = summarizeAndroidBenchmarkArtifacts({
      smokeDir: snapshots,
      telemetryCsvPath: null,
      telemetryMetaPath: null,
      perfettoPath: null,
      perfettoLogPath: null,
    });

    // T1: download p95 should be worst case of [12000, 13500]
    expect(summary.targetEvidence.T1.status).toBe("pass");
    expect(summary.targetEvidence.T1.actualMs).toBe(13500);

    // T2: ingest p95 should be worst case of [14000, 16000]
    expect(summary.targetEvidence.T2.status).toBe("pass");
    expect(summary.targetEvidence.T2.actualMs).toBe(16000);

    // T3: browse p95 from windowMs [500, 480]
    expect(summary.targetEvidence.T3.status).toBe("pass");
    expect(summary.targetEvidence.T3.actualMs).toBe(500);

    // T5: playback p95 from [700, 650]
    expect(summary.targetEvidence.T5.status).toBe("pass");
    expect(summary.targetEvidence.T5.actualMs).toBe(700);

    // T4: filter p95 from [900, 850]
    expect(summary.targetEvidence.T4.status).toBe("pass");
    expect(summary.targetEvidence.T4.actualMs).toBe(900);
    expect(summary.feedbackEvidence.playlistFilter?.playlistSize).toBe(6000);
  });

  it("correctly identifies target failures when metrics exceed budgets", () => {
    const snapshots = [
      {
        scenario: "install",
        hvscPerfTimings: [
          { scope: "download", durationMs: 25000 },
          { scope: "ingest:extract", durationMs: 15000 },
          { scope: "ingest:index-build", durationMs: 20000 },
        ],
      },
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 3000 }],
        metadata: { windowMs: 3500 },
      },
      {
        scenario: "playback-start",
        hvscPerfTimings: [{ scope: "playback:first-audio", durationMs: 1500 }],
      },
      {
        scenario: "playlist-filter-high",
        hvscPerfTimings: [{ scope: "playlist:filter", durationMs: 2500 }],
      },
    ];

    const summary = summarizeAndroidBenchmarkArtifacts({
      smokeDir: snapshots,
      telemetryCsvPath: null,
      telemetryMetaPath: null,
      perfettoPath: null,
      perfettoLogPath: null,
    });

    expect(summary.targetEvidence.T1.status).toBe("fail");
    expect(summary.targetEvidence.T2.status).toBe("fail");
    expect(summary.targetEvidence.T3.status).toBe("fail");
    expect(summary.targetEvidence.T4.status).toBe("fail");
    expect(summary.targetEvidence.T5.status).toBe("fail");
  });

  it("excludes warmup snapshots when only measured files are passed", () => {
    // Simulate: warmup produced a browse-query with 5000ms, measured produced 400ms
    // The summary should only see the measured 400ms because the runner filters files
    const measuredOnly = [
      {
        scenario: "browse-query",
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 400 }],
        metadata: { windowMs: 500 },
      },
    ];

    const summary = summarizeAndroidBenchmarkArtifacts({
      smokeDir: measuredOnly,
      telemetryCsvPath: null,
      telemetryMetaPath: null,
      perfettoPath: null,
      perfettoLogPath: null,
    });

    expect(summary.targetEvidence.T3.actualMs).toBe(500);
    expect(summary.targetEvidence.T3.status).toBe("pass");
  });
});
