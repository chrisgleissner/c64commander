import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  setExternalLogs: vi.fn(),
}));

import { addLog, setExternalLogs } from "@/lib/logging";
import { startWebServerLogBridge } from "@/lib/diagnostics/webServerLogs";

describe("webServerLogs bridge", () => {
  const originalFlag = import.meta.env.VITE_WEB_PLATFORM;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (import.meta.env as any).VITE_WEB_PLATFORM = "1";
  });

  afterEach(() => {
    (import.meta.env as any).VITE_WEB_PLATFORM = originalFlag;
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("normalizes successful server logs and clears on dispose", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        logs: [
          {
            id: "10",
            timestamp: "2026-03-02T11:00:00.000Z",
            level: "info",
            message: "ready",
            details: { a: 1 },
          },
        ],
      }),
    } as any);

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);

    expect(setExternalLogs).toHaveBeenCalledWith([
      {
        id: "server-10",
        timestamp: "2026-03-02T11:00:00.000Z",
        level: "info",
        message: "ready",
        details: { a: 1 },
      },
    ]);

    dispose();
    expect(setExternalLogs).toHaveBeenLastCalledWith([]);
  });

  it("clears server logs on unauthorized response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    } as any);

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);

    expect(setExternalLogs).toHaveBeenCalledWith([]);
    dispose();
  });

  it("returns no-op when VITE_WEB_PLATFORM is not set", () => {
    // Covers the isWebPlatformServerMode() false branch — early return without polling
    (import.meta.env as any).VITE_WEB_PLATFORM = "0";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const dispose = startWebServerLogBridge();
    expect(fetchSpy).not.toHaveBeenCalled();
    dispose();
  });

  it("ignores non-ok non-401 responses without updating logs", async () => {
    // Covers the missing else branch for a 500 response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);
    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);
    // setExternalLogs should NOT have been called (no 401, no ok)
    expect(setExternalLogs).not.toHaveBeenCalled();
    dispose();
  });

  it("rate-limits poll error logs to once per minute", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(61_000);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom"));

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(addLog).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(90_000);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
    expect(addLog).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(123_000);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
    expect(addLog).toHaveBeenCalledTimes(2);

    dispose();
    nowSpy.mockRestore();
  });

  it("uses String() when a non-Error value is thrown during poll", async () => {
    // Covers the `error instanceof Error ? ... : String(error)` false branch
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(61_000);
    globalThis.fetch = vi.fn().mockRejectedValue("plain string error");

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Web server log bridge poll failed",
      expect.objectContaining({ error: "plain string error" }),
    );
    dispose();
    nowSpy.mockRestore();
  });

  it("filters out log entries with non-string id or timestamp", async () => {
    // Covers normalizeLogs filter branches for invalid id and invalid timestamp
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        logs: [
          {
            id: 42,
            timestamp: "2026-03-01T00:00:00Z",
            level: "info",
            message: "id-is-number",
          },
          { id: "ok", timestamp: null, level: "info", message: "ts-is-null" },
          {
            id: "valid",
            timestamp: "2026-03-01T00:00:00Z",
            level: "info",
            message: "good",
          },
        ],
      }),
    } as any);

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);

    expect(setExternalLogs).toHaveBeenCalledWith([expect.objectContaining({ id: "server-valid", message: "good" })]);
    dispose();
  });

  it("uses empty logs array when response is ok but payload has no logs key", async () => {
    // Covers the payload.logs ?? [] branch when the logs key is absent
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any);

    const dispose = startWebServerLogBridge();
    await vi.advanceTimersByTimeAsync(10);

    expect(setExternalLogs).toHaveBeenCalledWith([]);
    dispose();
  });
});
