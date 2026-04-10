import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSavedDeviceHealthChecks } from "@/hooks/useSavedDeviceHealthChecks";
import { DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT } from "@/lib/diagnostics/diagnosticsTestBridge";

const { mockRunHealthCheckForTarget, mockGetPasswordForDevice } = vi.hoisted(() => ({
  mockRunHealthCheckForTarget: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
}));

vi.mock("@/lib/diagnostics/healthCheckEngine", () => ({
  runHealthCheckForTarget: mockRunHealthCheckForTarget,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPasswordForDevice: mockGetPasswordForDevice,
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const devices = [
  {
    id: "device-office",
    name: "Office U64",
    host: "office-u64",
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 64,
    lastKnownProduct: "U64",
    lastKnownHostname: "office-u64",
    lastKnownUniqueId: "UID-OFFICE",
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: false,
  },
  {
    id: "device-backup",
    name: "Backup U64",
    host: "backup-u64",
    httpPort: 8080,
    ftpPort: 2021,
    telnetPort: 2323,
    lastKnownProduct: "U64E",
    lastKnownHostname: "backup-u64",
    lastKnownUniqueId: "UID-BACKUP",
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: true,
  },
] as const;

const makeResult = (label: string) => ({
  runId: `hcr-${label}`,
  startTimestamp: "2026-01-01T12:00:00.000Z",
  endTimestamp: "2026-01-01T12:00:01.000Z",
  totalDurationMs: 1000,
  overallHealth: label === "backup" ? "Degraded" : "Healthy",
  connectivity: "Online" as const,
  probes: {
    REST: { probe: "REST" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 1 },
    FTP: { probe: "FTP" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 2 },
    TELNET: { probe: "TELNET" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 3 },
    CONFIG: { probe: "CONFIG" as const, outcome: "Skipped" as const, durationMs: null, reason: "Passive", startMs: 4 },
    RASTER: { probe: "RASTER" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 5 },
    JIFFY: { probe: "JIFFY" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 6 },
  },
  latency: { p50: 100, p90: 100, p99: 100 },
  deviceInfo: {
    firmware: "3.11",
    fpga: "1.42",
    core: "C64",
    uptimeSeconds: 256,
    product: "Ultimate 64 Elite",
  },
});

describe("useSavedDeviceHealthChecks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetPasswordForDevice.mockResolvedValue("secret");
    mockRunHealthCheckForTarget.mockImplementation(async (target: { deviceHost: string }) =>
      target.deviceHost.includes("backup") ? makeResult("backup") : makeResult("office"),
    );
  });

  afterEach(() => {
    delete window.__c64uDiagnosticsTestBridge;
    vi.useRealTimers();
  });

  it("runs concurrent passive checks for all devices and reruns every 10 seconds while enabled", async () => {
    const { result } = renderHook(() => useSavedDeviceHealthChecks([...devices], true));

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2));

    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceHost: "office-u64", ftpPort: 21, telnetPort: 64, password: null }),
      expect.objectContaining({ mode: "passive" }),
    );
    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceHost: "backup-u64:8080", ftpPort: 2021, telnetPort: 2323, password: "secret" }),
      expect.objectContaining({ mode: "passive" }),
    );
    expect(result.current.byDeviceId["device-office"]?.latestResult?.overallHealth).toBe("Healthy");
    expect(result.current.byDeviceId["device-backup"]?.latestResult?.overallHealth).toBe("Degraded");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(4));
  });

  it("manual refresh forces a new all-device cycle before the next interval", async () => {
    const { result } = renderHook(() => useSavedDeviceHealthChecks([...devices], true));

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2));

    await act(async () => {
      result.current.refreshAll();
    });

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(4));
  });

  it("prefers seeded saved-device health state from the diagnostics test bridge", async () => {
    window.__c64uDiagnosticsTestBridge = {
      getSavedDeviceHealthSnapshot: () => ({
        byDeviceId: {
          "device-office": {
            running: true,
            latestResult: null,
            liveProbes: {
              REST: {
                probe: "REST",
                outcome: "Success",
                durationMs: 50,
                reason: null,
                startMs: 1,
              },
            },
            probeStates: {
              REST: {
                state: "SUCCESS",
                outcome: "Success",
                startedAt: "2026-01-01T12:00:00.000Z",
                endedAt: "2026-01-01T12:00:00.050Z",
                durationMs: 50,
                reason: null,
              },
              FTP: { state: "PENDING", outcome: null, startedAt: null, endedAt: null, durationMs: null, reason: null },
              TELNET: {
                state: "RUNNING",
                outcome: null,
                startedAt: "2026-01-01T12:00:00.051Z",
                endedAt: null,
                durationMs: null,
                reason: null,
              },
              CONFIG: {
                state: "PENDING",
                outcome: null,
                startedAt: null,
                endedAt: null,
                durationMs: null,
                reason: null,
              },
              RASTER: {
                state: "PENDING",
                outcome: null,
                startedAt: null,
                endedAt: null,
                durationMs: null,
                reason: null,
              },
              JIFFY: {
                state: "PENDING",
                outcome: null,
                startedAt: null,
                endedAt: null,
                durationMs: null,
                reason: null,
              },
            },
            lastStartedAt: "2026-01-01T12:00:00.000Z",
            lastCompletedAt: null,
            error: null,
          },
        },
        cycle: {
          running: true,
          lastStartedAt: "2026-01-01T12:00:00.000Z",
          lastCompletedAt: null,
        },
      }),
    } as typeof window.__c64uDiagnosticsTestBridge;

    const { result } = renderHook(() => useSavedDeviceHealthChecks([...devices], true));

    expect(result.current.cycle.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.liveProbes?.REST?.outcome).toBe("Success");
    expect(mockRunHealthCheckForTarget).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT, {
          detail: null,
        }),
      );
    });

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2));
  });

  it("switches from live polling to seeded saved-device state after mount without breaking updates", async () => {
    window.__c64uDiagnosticsTestBridge = {
      getSavedDeviceHealthSnapshot: () => null,
    } as typeof window.__c64uDiagnosticsTestBridge;

    const { result } = renderHook(() => useSavedDeviceHealthChecks([...devices], true));

    await waitFor(() => expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT, {
          detail: {
            byDeviceId: {
              "device-office": {
                running: true,
                latestResult: null,
                liveProbes: {
                  REST: {
                    probe: "REST",
                    outcome: "Success",
                    durationMs: 50,
                    reason: null,
                    startMs: 1,
                  },
                },
                probeStates: {
                  REST: {
                    state: "SUCCESS",
                    outcome: "Success",
                    startedAt: "2026-01-01T12:00:00.000Z",
                    endedAt: "2026-01-01T12:00:00.050Z",
                    durationMs: 50,
                    reason: null,
                  },
                  FTP: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                  },
                  TELNET: {
                    state: "RUNNING",
                    outcome: null,
                    startedAt: "2026-01-01T12:00:00.051Z",
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                  },
                  CONFIG: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                  },
                  RASTER: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                  },
                  JIFFY: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                  },
                },
                lastStartedAt: "2026-01-01T12:00:00.000Z",
                lastCompletedAt: null,
                error: null,
              },
            },
            cycle: {
              running: true,
              lastStartedAt: "2026-01-01T12:00:00.000Z",
              lastCompletedAt: null,
            },
          },
        }),
      );
    });

    expect(result.current.cycle.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.liveProbes?.REST?.outcome).toBe("Success");
  });
});
