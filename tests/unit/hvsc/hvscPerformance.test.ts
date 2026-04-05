import { beforeEach, describe, expect, it } from "vitest";
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
});
