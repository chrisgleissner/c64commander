/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getLogs = vi.fn(() => [{ id: "2", timestamp: "2025-01-02T00:00:00Z", message: "log" }]);
const getErrorLogs = vi.fn(() => [{ id: "1", timestamp: "2025-01-01T00:00:00Z", message: "err" }]);
const addErrorLog = vi.fn();
const buildActionSummaries = vi.fn(() => [
  {
    correlationId: "a1",
    actionName: "Save Debug Log",
    origin: "user",
    startTimestamp: "2025-01-01T00:00:00Z",
    endTimestamp: "2025-01-01T00:00:01Z",
    durationMs: 1000,
    outcome: "success",
    startRelativeMs: 0,
    effects: [
      {
        type: "TELNET",
        label: "Save Debug Log",
        actionId: "saveDebugLog",
        actionLabel: "Save Debug Log",
        menuPath: ["Developer", "Save Debug Log"],
        hostname: "u64",
        port: 23,
        target: "real-device",
        result: "success",
        requestPayload: { steps: [{ type: "connect", host: "u64", port: 23 }] },
        responsePayload: { steps: [{ type: "visible-text", text: "Developer menu visible" }] },
      },
    ],
  },
]);
const buildNetworkSnapshot = vi.fn(() => ({ status: "ok" }));
const getTraceEvents = vi.fn(() => [
  {
    id: "t1",
    type: "telnet-operation",
    origin: "user",
    correlationId: "a1",
    timestamp: "2025-01-01T00:00:00Z",
    relativeMs: 0,
    data: {
      lifecycleState: "foreground",
      sourceKind: null,
      localAccessMode: null,
      trackInstanceId: null,
      playlistItemId: null,
      actionId: "saveDebugLog",
      actionLabel: "Save Debug Log",
      menuPath: ["Developer", "Save Debug Log"],
      hostname: "u64",
      port: 23,
      requestPayload: { steps: [{ type: "connect", host: "u64", port: 23 }] },
      responsePayload: { steps: [{ type: "visible-text", text: "Developer menu visible" }] },
      result: "success",
      durationMs: 120,
      error: null,
      target: "real-device",
    },
  },
]);
const getPlatform = vi.fn(() => "ios");
const pushNativeDebugSnapshots = vi.fn(async () => undefined);

vi.mock("@/lib/logging", () => ({
  getLogs,
  getErrorLogs,
  addErrorLog,
}));

vi.mock("@/lib/diagnostics/actionSummaries", () => ({
  buildActionSummaries,
}));

vi.mock("@/lib/diagnostics/networkSnapshot", () => ({
  buildNetworkSnapshot,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  getTraceEvents,
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform,
}));

vi.mock("@/lib/native/diagnosticsBridge", () => ({
  pushNativeDebugSnapshots,
}));

describe("nativeDebugSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    getPlatform.mockReturnValue("ios");
  });

  it("publishes immediately and on throttled update events", async () => {
    const { startNativeDebugSnapshotPublisher } = await import("@/lib/diagnostics/nativeDebugSnapshots");

    const stop = startNativeDebugSnapshotPublisher();
    await vi.runAllTimersAsync();
    expect(pushNativeDebugSnapshots).toHaveBeenCalledTimes(1);
    expect(pushNativeDebugSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        trace: expect.stringContaining('"requestPayload"'),
        actions: expect.stringContaining('"hostname": "u64"'),
      }),
    );

    window.dispatchEvent(new Event("c64u-traces-updated"));
    window.dispatchEvent(new Event("c64u-logs-updated"));
    await vi.advanceTimersByTimeAsync(130);

    expect(pushNativeDebugSnapshots).toHaveBeenCalledTimes(2);

    stop();
  });

  it("logs publish errors and noops on non-ios platform", async () => {
    pushNativeDebugSnapshots.mockRejectedValueOnce(new Error("push failed"));
    const { startNativeDebugSnapshotPublisher } = await import("@/lib/diagnostics/nativeDebugSnapshots");

    const stop = startNativeDebugSnapshotPublisher();
    await vi.runAllTimersAsync();

    expect(addErrorLog).toHaveBeenCalledWith(
      "Native debug snapshot publish failed",
      expect.objectContaining({ error: "push failed" }),
    );
    stop();

    getPlatform.mockReturnValue("web");
    const stopNoop = startNativeDebugSnapshotPublisher();
    expect(typeof stopNoop).toBe("function");
    stopNoop();
  });
});
