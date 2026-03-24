import { describe, expect, it } from "vitest";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import type { TraceEvent } from "@/lib/tracing/types";

const baseContext = {
  lifecycleState: "foreground",
  sourceKind: null,
  localAccessMode: null,
  trackInstanceId: null,
  playlistItemId: null,
} as const;

const makeEvent = (
  id: string,
  type: TraceEvent["type"],
  correlationId: string,
  relativeMs: number,
  data: Record<string, unknown>,
  timestamp?: string,
  origin: TraceEvent["origin"] = "user",
): TraceEvent => ({
  id,
  type,
  correlationId,
  relativeMs,
  timestamp: timestamp ?? `2026-03-02T10:00:${String(relativeMs).padStart(2, "0")}.000Z`,
  origin,
  data: {
    ...baseContext,
    ...data,
  },
});

describe("actionSummaries", () => {
  it("builds complete summary with REST/FTP/error effects", () => {
    const events: TraceEvent[] = [
      makeEvent("1", "action-start", "abc", 10, {
        name: "Refresh",
        trigger: { kind: "user", name: "tap", intervalMs: null, details: null },
      }),
      makeEvent("2", "rest-request", "abc", 11, {
        method: "GET",
        normalizedUrl: "/v1/version",
        target: "real-device",
        headers: { accept: "application/json" },
        payloadPreview: { byteCount: 0, previewByteCount: 0, hex: "", ascii: "", truncated: false },
      }),
      makeEvent("3", "rest-response", "abc", 13, {
        status: 200,
        durationMs: 123,
        headers: { "content-type": "application/json" },
        body: { product: "C64U" },
        payloadPreview: {
          byteCount: 18,
          previewByteCount: 18,
          hex: "7b 22 70 72 6f 64 75 63 74 22 3a 22 43 36 34 55 22 7d",
          ascii: '{"product":"C64U"}',
          truncated: false,
        },
      }),
      makeEvent("4", "ftp-operation", "abc", 14, {
        operation: "LIST",
        path: "/music",
        target: "real-device",
        result: "ok",
        requestPayload: { path: "/music" },
        responsePayload: { entries: [] },
      }),
      makeEvent("5", "error", "abc", 15, { message: "minor warning" }),
      makeEvent("6", "action-end", "abc", 16, { status: "success" }),
    ];

    const [summary] = buildActionSummaries(events);
    expect(summary).toMatchObject({
      correlationId: "abc",
      actionName: "Refresh",
      origin: "user",
      outcome: "success",
      restCount: 1,
      ftpCount: 1,
      errorCount: 1,
      trigger: { kind: "user", name: "tap" },
    });
    expect(summary.durationMs).toBe(4000);
    expect(summary.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REST",
          method: "GET",
          path: "/v1/version",
          product: "C64U",
          status: 200,
          requestHeaders: { accept: "application/json" },
          responseHeaders: { "content-type": "application/json" },
          responsePayloadPreview: expect.objectContaining({ ascii: '{"product":"C64U"}' }),
        }),
        expect.objectContaining({
          type: "FTP",
          operation: "LIST",
          path: "/music",
          requestPayload: { path: "/music" },
          responsePayload: { entries: [] },
        }),
        expect.objectContaining({ type: "ERROR", message: "minor warning" }),
      ]),
    );
  });

  it("handles incomplete actions with fallback naming and unknown origin", () => {
    const events: TraceEvent[] = [
      makeEvent("1", "rest-request", "missing-start", 30, {
        method: "POST",
        url: "http://127.0.0.1:8080/v1/config",
      }),
      makeEvent("2", "rest-response", "missing-start", 31, {
        status: 503,
        error: "service unavailable",
      }),
    ];
    (events[0] as any).origin = "legacy";
    (events[1] as any).origin = "legacy";

    const [summary] = buildActionSummaries(events);
    expect(summary.actionName).toBe("Action missing-start");
    expect(summary.origin).toBe("unknown");
    expect(summary.outcome).toBe("in_progress");
    expect(summary.durationMs).toBe(1000);
    expect(summary.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REST",
          status: 503,
          error: "service unavailable",
        }),
      ]),
    );
  });

  it("adds pending REST request effect and action-end fallback error", () => {
    const events: TraceEvent[] = [
      makeEvent("1", "action-start", "pending", 1, { name: "Write config" }, undefined, "automatic"),
      makeEvent("2", "rest-request", "pending", 2, {
        method: "PUT",
        url: "/v1/config",
        target: "internal-mock",
      }),
      makeEvent("3", "action-end", "pending", 4, { status: "error", error: "write failed" }, undefined, "automatic"),
    ];

    const [summary] = buildActionSummaries(events);
    expect(summary.origin).toBe("system");
    expect(summary.originalOrigin).toBe("automatic");
    expect(summary.outcome).toBe("error");
    expect(summary.errorMessage).toBe("write failed");
    expect(summary.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REST",
          method: "PUT",
          status: "error",
          error: "write failed",
        }),
        expect.objectContaining({
          type: "ERROR",
          label: "action-end error",
          message: "write failed",
        }),
      ]),
    );
  });
});
