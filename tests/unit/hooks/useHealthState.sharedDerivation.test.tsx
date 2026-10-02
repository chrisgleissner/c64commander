import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHealthState } from "@/hooks/useHealthState";
import * as healthModel from "@/lib/diagnostics/healthModel";
import type { TraceEvent } from "@/lib/tracing/types";

const traceStore = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: "REAL_CONNECTED", lastProbeError: null }),
}));

vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  useHealthCheckState: () => ({ latestResult: null }),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: { deviceInfo: { product: "C64 Ultimate", firmware_version: "1.1.0" } } }),
}));

vi.mock("@/lib/connection/hostEdit", () => ({
  getConfiguredHost: () => "c64u",
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  getTraceEvents: () => [...traceStore.events],
}));

vi.mock("@/lib/diagnostics/healthModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/diagnostics/healthModel")>();
  return { ...actual, deriveRestContributorHealth: vi.fn(actual.deriveRestContributorHealth) };
});

let eventCounter = 0;
const restResponse = (status: number, path: string): TraceEvent => {
  eventCounter += 1;
  return {
    id: `EVT-${eventCounter}`,
    timestamp: new Date().toISOString(),
    relativeMs: eventCounter,
    type: "rest-response",
    origin: "user",
    correlationId: `COR-${eventCounter}`,
    data: { method: "GET", path, status, hostname: "c64u" },
  } as TraceEvent;
};

const recordTrace = (event: TraceEvent) => {
  traceStore.events = [...traceStore.events, event];
  window.dispatchEvent(new CustomEvent("c64u-traces-updated"));
};

const restDerivations = () => vi.mocked(healthModel.deriveRestContributorHealth).mock.calls.length;

describe("useHealthState shared, coalesced derivation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    traceStore.events = [restResponse(200, "/v1/info")];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives health once for a burst of trace updates and still delivers the final one", () => {
    const { result } = renderHook(() => useHealthState());
    vi.mocked(healthModel.deriveRestContributorHealth).mockClear();

    for (let keystroke = 0; keystroke < 10; keystroke += 1) {
      act(() => {
        recordTrace(restResponse(200, `/v1/search/${keystroke}`));
        vi.advanceTimersByTime(20);
      });
    }
    expect(restDerivations()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(restDerivations()).toBe(1);
    expect(result.current.lastRestActivity?.operation).toBe("GET /v1/search/9");
  });

  it("gives the badge and the diagnostics overlay one shared derivation per trace update", () => {
    const badge = renderHook(() => useHealthState());
    const overlay = renderHook(() => useHealthState());
    vi.mocked(healthModel.deriveRestContributorHealth).mockClear();

    act(() => {
      recordTrace(restResponse(503, "/v1/machine:reset"));
      vi.advanceTimersByTime(250);
    });

    expect(restDerivations()).toBe(1);
    expect(badge.result.current.contributors.REST.failedOperations).toBe(1);
    expect(overlay.result.current).toEqual(badge.result.current);
  });
});
