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
});
