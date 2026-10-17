/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import type { HvscProgressEvent } from "@/lib/hvsc/hvscTypes";
import { applyHvscStageEvent, type HvscStageMeasurements } from "@/lib/hvsc/hvscStageMetrics";
import { formatRemaining, stageDetailLabel, stageRatePerSecond, stageRemainingMs } from "@/lib/hvsc/hvscStageDetail";

const event = (stage: string, extra: Partial<HvscProgressEvent> = {}): HvscProgressEvent => ({
  ingestionId: "test",
  stage,
  message: "",
  ...extra,
});

const run = (steps: Array<[number, HvscProgressEvent]>): HvscStageMeasurements =>
  steps.reduce<HvscStageMeasurements>((acc, [nowMs, e]) => applyHvscStageEvent(acc, e, nowMs), {});

describe("hvscStageMetrics", () => {
  it("measures each step from its own first event, not from the start of the run", () => {
    // Unpacking 1,000 files in 10 s is 100 files/s. The run-wide clock the events carry would be
    // 100 s old when unpacking ends, which reads 10 files/s.
    const m = run([
      [0, event("download", { downloadedBytes: 100, totalBytes: 100 })],
      [90_000, event("archive_extraction", { processedCount: 1, totalCount: 1_000 })],
      [100_000, event("archive_extraction", { processedCount: 1_000, totalCount: 1_000 })],
    ]);

    expect(stageRatePerSecond(m.unpack, 100_000)).toBeCloseTo(100, 0);
  });

  it("freezes a step's rate when the next step starts", () => {
    const m = run([
      [0, event("archive_extraction", { processedCount: 500, totalCount: 1_000 })],
      [5_000, event("archive_extraction", { processedCount: 1_000, totalCount: 1_000 })],
      [5_100, event("sid_metadata_hydration", { processedCount: 0, totalCount: 61_000, statusToken: "queued" })],
    ]);

    expect(m.unpack?.finishedAtMs).toBe(5_100);
    const rateAtEnd = stageRatePerSecond(m.unpack, 5_100);
    expect(stageRatePerSecond(m.unpack, 600_000)).toBe(rateAtEnd);
  });

  it("keeps the final analysis pass as its own step with its own counters", () => {
    const m = run([
      [0, event("sid_metadata_parsing", { ingestedSongs: 100, totalSongs: 100 })],
      [10_000, event("sid_metadata_hydration", { processedCount: 0, totalCount: 60_000, statusToken: "queued" })],
      [20_000, event("sid_metadata_hydration", { processedCount: 6_000, totalCount: 60_000, statusToken: "running" })],
    ]);

    expect(m.details?.finishedAtMs).toBe(10_000);
    expect(m.analyze).toEqual({ startedAtMs: 10_000, finishedAtMs: null, processed: 6_000, total: 60_000 });
    expect(stageRatePerSecond(m.analyze, 20_000)).toBe(600);
  });

  it("estimates the time left from the step's own rate", () => {
    const m = run([
      [0, event("sid_metadata_hydration", { processedCount: 0, totalCount: 60_000, statusToken: "queued" })],
      [10_000, event("sid_metadata_hydration", { processedCount: 6_000, totalCount: 60_000, statusToken: "running" })],
    ]);

    expect(stageRemainingMs(m.analyze, 10_000)).toBe(90_000);
    expect(stageDetailLabel("analyze", m.analyze, 10_000)).toBe("600 songs/s · about 2 min left");
  });

  it("gives no estimate in the first seconds of a step", () => {
    const m = run([
      [0, event("sid_metadata_hydration", { processedCount: 0, totalCount: 60_000, statusToken: "queued" })],
      [2_000, event("sid_metadata_hydration", { processedCount: 100, totalCount: 60_000, statusToken: "running" })],
    ]);

    expect(stageRemainingMs(m.analyze, 2_000)).toBeNull();
    expect(stageDetailLabel("analyze", m.analyze, 2_000)).toBe("50 songs/s");
  });

  it("reports the download in megabytes per second", () => {
    const m = run([
      [0, event("download", { downloadedBytes: 0, totalBytes: 100 * 1024 * 1024 })],
      [10_000, event("download", { downloadedBytes: 50 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 })],
    ]);

    expect(stageDetailLabel("download", m.download, 10_000)).toBe("5.0 MB/s · about 10 s left");
  });

  it("finishes the analysis on its done token and starts a new measurement for the next run", () => {
    const first = run([
      [0, event("sid_metadata_hydration", { processedCount: 0, totalCount: 10, statusToken: "queued" })],
      [4_000, event("sid_metadata_hydration", { processedCount: 10, totalCount: 10, statusToken: "done" })],
    ]);
    expect(first.analyze?.finishedAtMs).toBe(4_000);

    const second = applyHvscStageEvent(
      first,
      event("sid_metadata_hydration", { processedCount: 0, totalCount: 20, statusToken: "queued" }),
      900_000,
    );
    expect(second.analyze).toEqual({ startedAtMs: 900_000, finishedAtMs: null, processed: 0, total: 20 });
  });

  it("forgets everything when a new run starts", () => {
    const m = applyHvscStageEvent(
      run([[0, event("archive_extraction", { processedCount: 5, totalCount: 10 })]]),
      event("start"),
      1_000,
    );

    expect(m).toEqual({});
  });

  it("does not reopen a finished step when a late event for it arrives", () => {
    const m = run([
      [0, event("archive_extraction", { processedCount: 10, totalCount: 10 })],
      [1_000, event("sid_enumeration", { processedCount: 0, totalCount: 10 })],
      [2_000, event("archive_extraction", { processedCount: 10, totalCount: 10 })],
    ]);

    expect(m.unpack?.finishedAtMs).toBe(1_000);
  });

  it("formats the time left", () => {
    expect(formatRemaining(30_000)).toBe("about 30 s left");
    expect(formatRemaining(89_000)).toBe("about 89 s left");
    expect(formatRemaining(300_000)).toBe("about 5 min left");
  });
});
