import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginHvscPerfScope,
  collectHvscPerfTimings,
  endHvscPerfScope,
  resetHvscPerfTimings,
  runWithHvscPerfScope,
} from "@/lib/hvsc/hvscPerformance";

describe("hvscPerformance", () => {
  beforeEach(() => {
    resetHvscPerfTimings();
  });

  it("records completed scope timings with merged metadata", () => {
    const scope = beginHvscPerfScope("browse:query", { path: "/MUSICIANS", query: "commando" });
    const entry = endHvscPerfScope(scope, { phase: "index", resultCount: 3 });

    expect(entry.name).toBe("hvsc:perf:browse:query");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.metadata).toEqual(
      expect.objectContaining({
        path: "/MUSICIANS",
        query: "commando",
        phase: "index",
        resultCount: 3,
      }),
    );
  });

  it("keeps only the last 1000 timings in the ring buffer", () => {
    for (let index = 0; index < 1005; index += 1) {
      const scope = beginHvscPerfScope(`browse:query:${index}`);
      endHvscPerfScope(scope, { index });
    }

    const entries = collectHvscPerfTimings();
    expect(entries).toHaveLength(1000);
    expect(entries[0]?.scope).toBe("browse:query:5");
    expect(entries.at(-1)?.scope).toBe("browse:query:1004");
  });

  it("records failed async scopes with error metadata", async () => {
    await expect(
      runWithHvscPerfScope("playback:load-sid", async () => {
        throw new Error("load failed");
      }),
    ).rejects.toThrow("load failed");

    const entries = collectHvscPerfTimings();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toEqual(
      expect.objectContaining({
        outcome: "error",
        errorMessage: "load failed",
      }),
    );
  });

  it("uses unique performance mark names for overlapping scopes with the same name", () => {
    const first = beginHvscPerfScope("browse:query");
    const second = beginHvscPerfScope("browse:query");

    expect(first.name).toBe(second.name);
    expect(first.measureName).not.toBe(second.measureName);
    expect(first.startMarkName).not.toBe(second.startMarkName);

    const firstEntry = endHvscPerfScope(first);
    const secondEntry = endHvscPerfScope(second);

    expect(firstEntry.endMarkName).not.toBe(secondEntry.endMarkName);
    expect(collectHvscPerfTimings()).toHaveLength(2);
  });

  it("warns once and falls back to wall clock timing when performance.measure throws", () => {
    const measureSpy = vi.spyOn(performance, "measure").mockImplementation(() => {
      throw new Error("measure buffer full");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = beginHvscPerfScope("browse:query");
    const second = beginHvscPerfScope("browse:query");

    const firstEntry = endHvscPerfScope(first);
    const secondEntry = endHvscPerfScope(second);

    expect(firstEntry.durationMs).toBeGreaterThanOrEqual(0);
    expect(secondEntry.durationMs).toBeGreaterThanOrEqual(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "HVSC performance API call failed; falling back to wall clock timing",
      expect.objectContaining({
        operation: "measure",
        scopeName: "hvsc:perf:browse:query",
        error: "measure buffer full",
      }),
    );

    measureSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("falls back to Date.now and skips mark/measure guards when performance API is unavailable", () => {
    vi.stubGlobal("performance", undefined);
    try {
      const token = beginHvscPerfScope("browse:no-perf");
      const entry = endHvscPerfScope(token);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(collectHvscPerfTimings()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to wall clock timing when measurePerformance guard triggers due to missing getEntriesByName", () => {
    const origFn = (performance as Record<string, unknown>).getEntriesByName;
    (performance as Record<string, unknown>).getEntriesByName = undefined;
    try {
      const token = beginHvscPerfScope("browse:no-get-entries");
      const entry = endHvscPerfScope(token);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      (performance as Record<string, unknown>).getEntriesByName = origFn;
    }
  });

  it("falls back to wall clock timing when getEntriesByName returns empty array", () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
    const token = beginHvscPerfScope("browse:empty-entries");
    const entry = endHvscPerfScope(token);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses String() for non-Error values thrown by performance.mark", () => {
    const markSpy = vi.spyOn(performance, "mark").mockImplementation(() => {
      throw "quota_exceeded_string";
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const token = beginHvscPerfScope("browse:mark-non-error");
    endHvscPerfScope(token);
    expect(warnSpy).toHaveBeenCalledWith(
      "HVSC performance API call failed; falling back to wall clock timing",
      expect.objectContaining({ operation: "mark", error: "quota_exceeded_string" }),
    );
    markSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("skips clearMarks cleanup when performance.clearMarks is not a function", () => {
    const origClearMarks = (performance as Record<string, unknown>).clearMarks;
    (performance as Record<string, unknown>).clearMarks = undefined;
    try {
      const token = beginHvscPerfScope("browse:no-clear-marks");
      expect(() => endHvscPerfScope(token)).not.toThrow();
      expect(collectHvscPerfTimings()).toHaveLength(1);
    } finally {
      (performance as Record<string, unknown>).clearMarks = origClearMarks;
    }
  });

  it("skips clearMeasures cleanup when performance.clearMeasures is not a function", () => {
    const origClearMeasures = (performance as Record<string, unknown>).clearMeasures;
    (performance as Record<string, unknown>).clearMeasures = undefined;
    try {
      const token = beginHvscPerfScope("browse:no-clear-measures");
      expect(() => endHvscPerfScope(token)).not.toThrow();
      expect(collectHvscPerfTimings()).toHaveLength(1);
    } finally {
      (performance as Record<string, unknown>).clearMeasures = origClearMeasures;
    }
  });
});
