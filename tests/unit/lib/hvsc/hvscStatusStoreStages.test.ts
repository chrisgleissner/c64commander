/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHvscProgressEventToSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
} from "@/lib/hvsc/hvscStatusStore";
import type { HvscProgressEvent } from "@/lib/hvsc/hvscTypes";

const event = (stage: string, extra: Partial<HvscProgressEvent> = {}): HvscProgressEvent => ({
  ingestionId: "test",
  stage,
  message: "",
  ...extra,
});

describe("hvsc status summary stage measurements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures the final analysis from its own first event, not from the start of the run", () => {
    let summary = getDefaultHvscStatusSummary();
    summary = applyHvscProgressEventToSummary(
      summary,
      event("archive_extraction", { processedCount: 10, totalCount: 10, elapsedTimeMs: 480_000 }),
    );
    vi.advanceTimersByTime(60_000);
    summary = applyHvscProgressEventToSummary(
      summary,
      event("sid_metadata_hydration", {
        statusToken: "queued",
        processedCount: 0,
        totalCount: 60_000,
        elapsedTimeMs: 0,
      }),
    );
    vi.advanceTimersByTime(20_000);
    summary = applyHvscProgressEventToSummary(
      summary,
      event("sid_metadata_hydration", {
        statusToken: "running",
        processedCount: 6_000,
        totalCount: 60_000,
        elapsedTimeMs: 20_000,
      }),
    );

    expect(summary.stages.unpack?.finishedAtMs).toBe(Date.parse("2026-10-17T08:01:00Z"));
    expect(summary.stages.analyze).toEqual({
      startedAtMs: Date.parse("2026-10-17T08:01:00Z"),
      finishedAtMs: null,
      processed: 6_000,
      total: 60_000,
    });
  });

  it("keeps the measurements through a save and load of the persisted summary", () => {
    const summary = applyHvscProgressEventToSummary(
      getDefaultHvscStatusSummary(),
      event("sid_metadata_hydration", { statusToken: "running", processedCount: 5, totalCount: 10 }),
    );
    saveHvscStatusSummary(summary);

    expect(loadHvscStatusSummary().stages.analyze?.processed).toBe(5);
  });

  it("loads a summary saved before stage measurements existed with no measurements", () => {
    const { stages: _stages, ...legacy } = getDefaultHvscStatusSummary();
    localStorage.setItem("c64u_hvsc_status:v1", JSON.stringify(legacy));

    expect(loadHvscStatusSummary().stages).toEqual({});
  });
});
