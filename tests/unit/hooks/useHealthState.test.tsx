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
    deviceInfo: null as { product?: string | null; firmware_version?: string | null } | null,
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

  it("does not report Healthy while online identity lacks product or firmware", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    healthModelMocks.rollUpHealth.mockImplementation(() => "Healthy");
    healthModelMocks.deriveRestContributorHealth.mockImplementation(() => ({
      state: "Healthy",
      problemCount: 0,
      totalOperations: 1,
      failedOperations: 0,
    }));
    c64ConnectionMock.status.deviceInfo = {
      product: "C64 Ultimate",
      firmware_version: null,
    };
    traceEventsMock.events = [{ type: "rest-response", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Degraded");
    expect(result.current.problemCount).toBe(1);
    expect(result.current.primaryProblem).toEqual(
      expect.objectContaining({
        title: "Device identity unavailable",
        contributor: "App",
      }),
    );
  });

  it("allows Healthy when online product and firmware identity are verified", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    healthModelMocks.rollUpHealth.mockImplementation(() => "Healthy");
    healthModelMocks.deriveRestContributorHealth.mockImplementation(() => ({
      state: "Healthy",
      problemCount: 0,
      totalOperations: 1,
      failedOperations: 0,
    }));
    c64ConnectionMock.status.deviceInfo = {
      product: "C64 Ultimate",
      firmware_version: "1.1.0",
    };
    traceEventsMock.events = [{ type: "rest-response", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Healthy");
    expect(result.current.problemCount).toBe(0);
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

  it("counts a TELNET probe failure as a problem and routes primaryProblem to TELNET contributor", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-telnet",
      overallHealth: "Degraded",
      endTimestamp: "2024-01-01T00:00:03.250Z",
      deviceInfo: { product: "Ultimate 64" },
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Success", reason: null },
        TELNET: { probe: "TELNET", outcome: "Fail", reason: "login timeout" },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.TELNET.state).toBe("Unhealthy");
    expect(result.current.primaryProblem).toEqual(
      expect.objectContaining({
        contributor: "TELNET",
        title: "TELNET health check failed",
        impactLevel: 1,
      }),
    );
  });

  it("maps partial probe outcomes to degraded contributor health without incrementing failures", () => {
    healthCheckStateMock.latestResult = {
      runId: "hc-partial",
      overallHealth: "Degraded",
      endTimestamp: "2024-01-01T00:00:03.500Z",
      deviceInfo: { product: "Ultimate 64" },
      probes: {
        CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
        JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
        REST: { probe: "REST", outcome: "Success", reason: null },
        FTP: { probe: "FTP", outcome: "Partial", reason: "intermittent listing timeout" },
        TELNET: { probe: "TELNET", outcome: "Success", reason: null },
      },
    };

    const { result } = renderHook(() => useHealthState());

    expect(result.current.contributors.FTP).toMatchObject({
      state: "Degraded",
      problemCount: 0,
      failedOperations: 0,
      totalOperations: 1,
    });
    expect(result.current.problemCount).toBe(0);
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
    const filteredEvents = (lastRestContributorCall as unknown[]).at(0);
    if (!filteredEvents) {
      throw new Error("deriveRestContributorHealth did not receive events");
    }

    expect(filteredEvents).toEqual([traceEventsMock.events[0]]);
  });

  it("filters unattributed follow-up events by the host derived from URL-based trace correlation", () => {
    configuredHostMock.host = "u64";
    traceEventsMock.events = [
      { type: "rest-response", correlationId: "u64-ok", data: { status: 200, url: "http://u64:8080/v1/info" } },
      { type: "ftp-operation", correlationId: "u64-ok", data: { result: "success" } },
      {
        type: "rest-response",
        correlationId: "c64u-off-host",
        data: { status: 500, url: "http://c64u:8080/v1/info" },
      },
      { type: "ftp-operation", correlationId: "c64u-off-host", data: { result: "failure" } },
    ];

    renderHook(() => useHealthState());

    const lastFtpContributorCall = healthModelMocks.deriveFtpContributorHealth.mock.calls.slice(-1)[0];
    if (!lastFtpContributorCall) {
      throw new Error("deriveFtpContributorHealth was not called");
    }
    const filteredEvents = (lastFtpContributorCall as unknown[]).at(0);
    if (!filteredEvents) {
      throw new Error("deriveFtpContributorHealth did not receive events");
    }

    expect(filteredEvents).toEqual([traceEventsMock.events[0], traceEventsMock.events[1]]);
  });

  it("ignores standalone error events even when the global trace context points at the selected host", () => {
    configuredHostMock.host = "u64";
    traceEventsMock.events = [
      { type: "rest-response", correlationId: "u64-ok", data: { status: 200, hostname: "u64" } },
      {
        type: "error",
        correlationId: "background-c64u-failure",
        data: {
          message: "background device failed",
          device: { host: "u64" },
        },
      },
    ];

    renderHook(() => useHealthState());

    const lastAppContributorCall = healthModelMocks.deriveAppContributorHealth.mock.calls.slice(-1)[0];
    if (!lastAppContributorCall) {
      throw new Error("deriveAppContributorHealth was not called");
    }
    const filteredEvents = (lastAppContributorCall as unknown[]).at(0);
    if (!filteredEvents) {
      throw new Error("deriveAppContributorHealth did not receive events");
    }

    expect(filteredEvents).toEqual([traceEventsMock.events[0]]);
  });

  it("keeps unattributed non-error events when URL parsing fails but still filters mismatched device attribution", () => {
    // F-DIAG-1: resolveTraceAttributedHost now reads `savedDeviceHostSnapshot`
    // (and `verifiedHostname`) from DiagnosticsDeviceContext, not a non-existent
    // `host` field. Tests now use the real attribution field names.
    configuredHostMock.host = "u64";
    traceEventsMock.events = [
      { type: "rest-response", correlationId: "u64-ok", data: { status: 200, hostname: "u64" } },
      {
        type: "custom-event",
        correlationId: "attr-u64",
        data: { device: { savedDeviceHostSnapshot: "u64:23" } },
      },
      {
        type: "custom-event",
        correlationId: "attr-c64u",
        data: { device: { savedDeviceHostSnapshot: "c64u:23" } },
      },
      { type: "custom-event", correlationId: "invalid-url", data: { url: "http://%zz" } },
    ];

    renderHook(() => useHealthState());

    const lastAppContributorCall = healthModelMocks.deriveAppContributorHealth.mock.calls.slice(-1)[0];
    if (!lastAppContributorCall) {
      throw new Error("deriveAppContributorHealth was not called");
    }
    const filteredEvents = (lastAppContributorCall as unknown[]).at(0);
    if (!filteredEvents) {
      throw new Error("deriveAppContributorHealth did not receive events");
    }

    expect(filteredEvents).toEqual([traceEventsMock.events[0], traceEventsMock.events[1], traceEventsMock.events[3]]);
  });

  // HARD19-004 (D1): a pinned manual health-check verdict must not out-live
  // contradicting live evidence. These exercise the trace-evidence override.
  const allSuccessProbes = () => ({
    CONFIG: { probe: "CONFIG", outcome: "Success", reason: null },
    JIFFY: { probe: "JIFFY", outcome: "Success", reason: null },
    REST: { probe: "REST", outcome: "Success", reason: null },
    FTP: { probe: "FTP", outcome: "Success", reason: null },
    TELNET: { probe: "TELNET", outcome: "Success", reason: null },
  });

  it("prefers live trace-derived health over a stale pinned Unhealthy after a newer REST success (HARD19-004 recovery)", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    healthModelMocks.rollUpHealth.mockImplementation(() => "Healthy");
    healthModelMocks.deriveRestContributorHealth.mockImplementation(() => ({
      state: "Healthy",
      problemCount: 0,
      totalOperations: 1,
      failedOperations: 0,
    }));
    c64ConnectionMock.status.deviceInfo = { product: "Ultimate 64", firmware_version: "1.1.0" };
    healthCheckStateMock.latestResult = {
      runId: "hc-stale-unhealthy",
      overallHealth: "Unhealthy",
      endTimestamp: "2024-01-01T00:00:00.000Z",
      deviceInfo: null,
      probes: { ...allSuccessProbes(), REST: { probe: "REST", outcome: "Fail", reason: "was down" } },
    };
    // A successful REST response recorded AFTER the pinned check proves recovery.
    traceEventsMock.events = [{ type: "rest-response", timestamp: "2024-01-01T00:05:00.000Z", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Healthy");
  });

  it("prefers live trace-derived health over a stale pinned Unhealthy after a newer FTP success (HARD19-004 recovery)", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    healthModelMocks.rollUpHealth.mockImplementation(() => "Healthy");
    healthModelMocks.deriveFtpContributorHealth.mockImplementation(() => ({
      state: "Healthy",
      problemCount: 0,
      totalOperations: 1,
      failedOperations: 0,
    }));
    c64ConnectionMock.status.deviceInfo = { product: "Ultimate 64", firmware_version: "1.1.0" };
    healthCheckStateMock.latestResult = {
      runId: "hc-stale-unhealthy-ftp",
      overallHealth: "Unhealthy",
      endTimestamp: "2024-01-01T00:00:00.000Z",
      deviceInfo: null,
      probes: { ...allSuccessProbes(), FTP: { probe: "FTP", outcome: "Fail", reason: "ftp was down" } },
    };
    traceEventsMock.events = [
      { type: "ftp-operation", timestamp: "2024-01-01T00:05:00.000Z", data: { result: "success", error: null } },
    ];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Healthy");
  });

  it("prefers live trace-derived health over a stale pinned Healthy after newer failures (HARD19-004 degradation)", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    healthModelMocks.rollUpHealth.mockImplementation(() => "Unhealthy");
    healthModelMocks.deriveRestContributorHealth.mockImplementation(() => ({
      state: "Unhealthy",
      problemCount: 2,
      totalOperations: 3,
      failedOperations: 2,
    }));
    c64ConnectionMock.status.deviceInfo = { product: "Ultimate 64", firmware_version: "1.1.0" };
    healthCheckStateMock.latestResult = {
      runId: "hc-stale-healthy",
      overallHealth: "Healthy",
      endTimestamp: "2024-01-01T00:00:00.000Z",
      deviceInfo: { product: "Ultimate 64" },
      probes: allSuccessProbes(),
    };
    traceEventsMock.events = [
      { type: "rest-response", timestamp: "2024-01-01T00:00:05.000Z", data: { status: 200 } },
      // A newer failing response contradicts the pinned Healthy verdict.
      { type: "rest-response", timestamp: "2024-01-01T00:05:00.000Z", data: { status: 503 } },
    ];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Unhealthy");
  });

  it("keeps the pinned verdict when no live evidence is newer than the health check (HARD19-004)", () => {
    connectionStateMock.state = "REAL_CONNECTED";
    healthModelMocks.deriveConnectivityState.mockImplementation(() => "Online");
    // If the override wrongly fired we'd get this trace-derived Healthy instead.
    healthModelMocks.rollUpHealth.mockImplementation(() => "Healthy");
    healthCheckStateMock.latestResult = {
      runId: "hc-pinned-unhealthy",
      overallHealth: "Unhealthy",
      endTimestamp: "2024-01-01T00:05:00.000Z",
      deviceInfo: null,
      probes: { ...allSuccessProbes(), REST: { probe: "REST", outcome: "Fail", reason: "down" } },
    };
    // Only OLDER evidence (before the pinned check) — must not override.
    traceEventsMock.events = [{ type: "rest-response", timestamp: "2024-01-01T00:00:00.000Z", data: { status: 200 } }];

    const { result } = renderHook(() => useHealthState());

    expect(result.current.state).toBe("Unhealthy");
  });
});
