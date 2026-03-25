import { describe, expect, it, vi } from "vitest";
import { TraceCollector } from "./traceCollector.js";

describe("TraceCollector", () => {
  it("logs actionable context when stream callbacks throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const collector = new TraceCollector("run-42");
    collector.setStageContext("stage-01", "stress");
    collector.onEmit(() => {
      throw new Error("stream boom");
    });

    collector.emit({
      protocol: "REST",
      direction: "request",
      correlationId: "corr-1",
      clientId: "client-1",
      timestamp: "2026-03-25T12:00:00.000Z",
      launchedAtMs: 100,
      hrTimeNs: 1n,
      method: "GET",
      url: "http://127.0.0.1/v1/version",
      headers: {},
      body: null,
    });

    expect(collector.snapshot()).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "TraceCollector.emit failed",
      expect.objectContaining({
        runSessionId: "run-42",
        stageId: "stage-01",
        testType: "stress",
        seq: 1,
        partial: expect.objectContaining({
          protocol: "REST",
          direction: "request",
          correlationId: "corr-1",
        }),
        error: expect.objectContaining({
          name: "Error",
          message: "stream boom",
          stack: expect.any(String),
        }),
      }),
    );
  });
});
