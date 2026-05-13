import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHealthState } from "@/hooks/useHealthState";

const idleContributor = () => ({ state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 });

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
  events: [] as Array<{ type: string; data: Record<string, unknown>; correlationId?: string }>,
}));

const configuredHostMock = vi.hoisted(() => ({
  host: "c64u",
}));

const healthModelMocks = vi.hoisted(() => ({
  deriveAppContributorHealth: vi.fn(() => idleContributor()),
  deriveConnectivityState: vi.fn(() => "Offline"),
  deriveFtpContributorHealth: vi.fn(() => idleContributor()),
  deriveLastFtpActivity: vi.fn(() => null),
  deriveLastRestActivity: vi.fn(() => null),
  deriveLastTelnetActivity: vi.fn(() => null),
  derivePrimaryProblem: vi.fn(() => null),
  deriveRestContributorHealth: vi.fn(() => ({
    state: "Unhealthy",
    problemCount: 1,
    totalOperations: 2,
    failedOperations: 1,
  })),
  deriveTelnetContributorHealth: vi.fn(() => idleContributor()),
  rollUpHealth: vi.fn(() => "Unhealthy"),
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
  getConfiguredHost: () => configuredHostMock.host,
}));

vi.mock("@/lib/diagnostics/healthModel", () => healthModelMocks);

vi.mock("@/lib/diagnostics/targetDisplayMapper", () => ({
  inferConnectedDeviceLabel: vi.fn(() => "Ultimate 64"),
}));

describe("useHealthState", () => {
  beforeEach(() => {
    connectionStateMock.state = "OFFLINE_NO_DEMO";
    healthCheckStateMock.latestResult = null;
    c64ConnectionMock.status.deviceInfo = null;
    traceEventsMock.events = [];
    configuredHostMock.host = "c64u";
    healthModelMocks.deriveAppContributorHealth.mockImplementation(() => idleContributor());
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Offline");
    healthModelMocks.deriveFtpContributorHealth.mockImplementation(() => idleContributor());
    healthModelMocks.deriveLastFtpActivity.mockImplementation(() => null);
    healthModelMocks.deriveLastRestActivity.mockImplementation(() => null);
    healthModelMocks.deriveLastTelnetActivity.mockImplementation(() => null);
    healthModelMocks.derivePrimaryProblem.mockImplementation(() => null);
    healthModelMocks.deriveRestContributorHealth.mockImplementation(() => ({
      state: "Unhealthy",
      problemCount: 1,
      totalOperations: 2,
      failedOperations: 1,
    }));
    healthModelMocks.deriveTelnetContributorHealth.mockImplementation(() => idleContributor());
    healthModelMocks.rollUpHealth.mockImplementation(() => "Unhealthy");
    Object.values(healthModelMocks).forEach((mock) => mock.mockClear());
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
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
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

  it("counts a REST probe failure as a problem and routes primaryProblem to REST contributor", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-rest",
      overallHealth: "Unhealthy",
      endTimestamp: "2024-01-01T00:00:02.000Z",
      deviceInfo: null,
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Fail", reason: "connection refused" },
        FTP: { probe: "FTP", outcome: "Success", reason: null },
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.REST.state).toBe("Unhealthy");
    expect(result.current.problemCount).toBe(1);
    expect(result.current.primaryProblem).toEqual(
      expect.objectContaining({
        contributor: "REST",
        title: "REST health check failed",
        impactLevel: 2,
      }),
    );
  });

  it("counts an FTP probe failure as a problem and routes primaryProblem to FTP contributor", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-ftp",
      overallHealth: "Degraded",
      endTimestamp: "2024-01-01T00:00:03.000Z",
      deviceInfo: { product: "C64" },
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Fail", reason: "auth failed" },
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.FTP.state).toBe("Unhealthy");
    expect(result.current.primaryProblem).toEqual(
      expect.objectContaining({
        contributor: "FTP",
        title: "FTP health check failed",
        impactLevel: 1,
      }),
    );
  });

  it("returns null primaryProblem and zero problemCount when all probes succeed", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-ok",
      overallHealth: "Healthy",
      endTimestamp: "2024-01-01T00:00:04.000Z",
      deviceInfo: null,
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Success", reason: null },
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.problemCount).toBe(0);
    expect(result.current.primaryProblem).toBeNull();
  });

  it("uses deviceInfo from c64Connection when health check deviceInfo is absent", () => {
    c64ConnectionMock.status.deviceInfo = { product: "Ultimate 64 E" };
    healthCheckStateMock.latestResult = {
      runId: "hc-nodevice",
      overallHealth: "Healthy",
      endTimestamp: "2024-01-01T00:00:05.000Z",
      deviceInfo: null,
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Skipped", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Success", reason: null },
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.App.state).toBe("Idle");
  });

  it("uses c64Connection deviceInfo in trace-derived path when deviceInfo product is set", () => {
    c64ConnectionMock.status.deviceInfo = { product: "Ultimate 64 E" };
    traceEventsMock.events = [{ type: "rest-response", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Unhealthy");
  });

  it("ignores trace failures from other hosts when deriving the selected device health", () => {
    configuredHostMock.host = "u64";
    traceEventsMock.events = [
      { type: "rest-response", correlationId: "u64-ok", data: { status: 200, hostname: "u64" } },
      { type: "rest-response", correlationId: "c64u-rest", data: { status: 500, hostname: "c64u" } },
      { type: "ftp-operation", correlationId: "c64u-ftp", data: { hostname: "c64u", result: "failure" } },
      { type: "error", correlationId: "u64-global", data: { message: "global warning" } },
      { type: "error", correlationId: "c64u-rest", data: { message: "off-host rest failure" } },
    ];

    renderHook(() => useHealthState());

    const lastRestContributorCall = healthModelMocks.deriveRestContributorHealth.mock.calls.slice(-1)[0];
    if (!lastRestContributorCall) {
      throw new Error("deriveRestContributorHealth was not called");
    }
    const [filteredEvents] = lastRestContributorCall;

    expect(filteredEvents).toEqual([traceEventsMock.events[0], traceEventsMock.events[3]]);
  });
});
