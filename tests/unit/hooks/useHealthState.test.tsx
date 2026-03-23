import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHealthState } from "@/hooks/useHealthState";

const connectionStateMock = vi.hoisted(() => ({
  state: "OFFLINE_NO_DEMO",
}));

const healthCheckStateMock = vi.hoisted(() => ({
  latestResult: null as Record<string, unknown> | null,
}));

const c64ConnectionMock = vi.hoisted(() => ({
  status: {
    deviceInfo: null as { product?: string | null } | null,
  },
}));

const traceEventsMock = vi.hoisted(() => ({
  events: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionStateMock,
}));

vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  useHealthCheckState: () => healthCheckStateMock,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => c64ConnectionMock,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  getTraceEvents: () => traceEventsMock.events,
}));

vi.mock("@/lib/connection/hostEdit", () => ({
  getConfiguredHost: () => "c64u",
}));

vi.mock("@/lib/diagnostics/healthModel", () => ({
  deriveAppContributorHealth: () => ({ state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 }),
  deriveConnectivityState: () => "Offline",
  deriveFtpContributorHealth: () => ({ state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 }),
  deriveLastFtpActivity: () => null,
  deriveLastRestActivity: () => null,
  derivePrimaryProblem: () => null,
  deriveRestContributorHealth: () => ({ state: "Unhealthy", problemCount: 1, totalOperations: 2, failedOperations: 1 }),
  rollUpHealth: (_contributors: unknown, _connectivity: unknown) => "Unhealthy",
}));

vi.mock("@/lib/diagnostics/targetDisplayMapper", () => ({
  inferConnectedDeviceLabel: vi.fn(() => "Ultimate 64"),
}));

describe("useHealthState", () => {
  beforeEach(() => {
    connectionStateMock.state = "OFFLINE_NO_DEMO";
    healthCheckStateMock.latestResult = null;
    c64ConnectionMock.status.deviceInfo = null;
    traceEventsMock.events = [];
  });

  it("prefers app probe failures over a successful JIFFY probe when a health check result exists", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-1",
      overallHealth: "Degraded",
      endTimestamp: "2024-01-01T00:00:01.000Z",
      deviceInfo: { product: "Ultimate 64" },
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Fail", reason: "config mismatch" },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.App.state).toBe("Unhealthy");
    expect(result.current.problemCount).toBe(1);
    expect(result.current.primaryProblem).toEqual(
      expect.objectContaining({
        contributor: "App",
        causeHint: "config mismatch",
        title: "CONFIG health check failed",
      }),
    );
  });

  it("returns Idle state on cold launch before any successful REST response", () => {
    // Regression for R11-007/R11-012: before the first clean REST response the
    // badge must not flip to Unhealthy from early probe or connection-retry noise.
    traceEventsMock.events = [{ type: "rest-response", data: { status: 503 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Idle");
    expect(result.current.problemCount).toBe(0);
    expect(result.current.primaryProblem).toBeNull();
  });

  it("transitions out of Idle once the first successful REST response is seen", () => {
    // After a 2xx response the health derivation runs normally; the rollUpHealth
    // mock returns "Unhealthy" to confirm the trace-derived path was reached.
    traceEventsMock.events = [{ type: "rest-response", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Unhealthy");
  });

  it("does not count 4xx/5xx responses as the first REST success", () => {
    traceEventsMock.events = [
      { type: "rest-response", data: { status: 404 } },
      { type: "rest-response", data: { status: 500 } },
    ];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Idle");
  });
});
