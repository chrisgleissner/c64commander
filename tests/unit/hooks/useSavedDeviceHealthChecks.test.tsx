import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSavedDeviceHealthChecks } from "@/hooks/useSavedDeviceHealthChecks";
import { HEALTH_CHECK_CONTEXTS } from "@/lib/diagnostics/healthCheckEngine";
import { DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT } from "@/lib/diagnostics/diagnosticsTestBridge";
import {
  beginSavedDeviceSwitchAttempt,
  clearSavedDeviceSwitchMetrics,
  completeSavedDeviceSwitchAttempt,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createAbortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

const createAbortablePendingRun = () => {
  return (_target: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((_, reject) => {
      options?.signal?.addEventListener("abort", () => reject(createAbortError()), {
        once: true,
      });
    });
};

const { mockRunHealthCheckForTarget, mockGetPasswordForDevice } = vi.hoisted(() => ({
  mockRunHealthCheckForTarget: vi.fn(),
  mockGetPasswordForDevice: vi.fn(),
}));

const diagnosticsSuppressionMock = vi.hoisted(() => {
  let active = false;
  const listeners = new Set<(active: boolean) => void>();
  return {
    isActive: () => active,
    setActive: (next: boolean) => {
      active = next;
      listeners.forEach((listener) => listener(active));
    },
    reset: () => {
      active = false;
      listeners.clear();
    },
    subscribe: (listener: (active: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/lib/diagnostics/healthCheckEngine", () => ({
  HEALTH_CHECK_CONTEXTS: {
    backgroundMaintenance: {
      context: "background-maintenance",
      configPulsePolicy: "read-only",
    },
    switchDeviceDialog: {
      context: "switch-device-dialog",
      configPulsePolicy: "visible-config-pulse-allowed",
    },
  },
  runHealthCheckForTarget: mockRunHealthCheckForTarget,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPasswordForDevice: mockGetPasswordForDevice,
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlaySuppressionArmed: () => diagnosticsSuppressionMock.isActive(),
  subscribeDiagnosticsSuppression: (listener: (active: boolean) => void) => diagnosticsSuppressionMock.subscribe(listener),
}));

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
    CONFIG: { probe: "CONFIG" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 4 },
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

const makeProbeStates = () => ({
  REST: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.000Z",
    endedAt: "2026-01-01T12:00:00.100Z",
    durationMs: 100,
    reason: null,
  },
  FTP: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.101Z",
    endedAt: "2026-01-01T12:00:00.200Z",
    durationMs: 100,
    reason: null,
  },
  TELNET: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.201Z",
    endedAt: "2026-01-01T12:00:00.300Z",
    durationMs: 100,
    reason: null,
  },
  CONFIG: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.301Z",
    endedAt: "2026-01-01T12:00:00.401Z",
    durationMs: 100,
    reason: null,
  },
  RASTER: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.302Z",
    endedAt: "2026-01-01T12:00:00.402Z",
    durationMs: 100,
    reason: null,
  },
  JIFFY: {
    state: "SUCCESS" as const,
    outcome: "Success" as const,
    startedAt: "2026-01-01T12:00:00.403Z",
    endedAt: "2026-01-01T12:00:00.503Z",
    durationMs: 100,
    reason: null,
  },
});

describe("useSavedDeviceHealthChecks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearSavedDeviceSwitchMetrics();
    diagnosticsSuppressionMock.reset();
    mockGetPasswordForDevice.mockResolvedValue("secret");
    mockRunHealthCheckForTarget.mockImplementation(async (target: { deviceHost: string }) =>
      target.deviceHost.includes("backup") ? makeResult("backup") : makeResult("office"),
    );
  });

  afterEach(() => {
    delete window.__c64uDiagnosticsTestBridge;
    vi.useRealTimers();
  });

  const buildSavedDevices = () => [...devices];

  const flushAsyncWork = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("runs concurrent background-maintenance checks for all devices and reruns every 10 seconds while enabled", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);

    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceHost: "office-u64", ftpPort: 21, telnetPort: 64, password: null }),
      expect.objectContaining({ context: HEALTH_CHECK_CONTEXTS.backgroundMaintenance }),
    );
    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceHost: "backup-u64:8080", ftpPort: 2021, telnetPort: 2323, password: "secret" }),
      expect.objectContaining({ context: HEALTH_CHECK_CONTEXTS.backgroundMaintenance }),
    );
    expect(result.current.byDeviceId["device-office"]?.latestResult?.overallHealth).toBe("Healthy");
    expect(result.current.byDeviceId["device-backup"]?.latestResult?.overallHealth).toBe("Degraded");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(4);
  });

  it("allows switch-device dialog checks to use the explicit visible config pulse context", async () => {
    const savedDevices = buildSavedDevices();
    renderHook(() => useSavedDeviceHealthChecks(savedDevices, true, HEALTH_CHECK_CONTEXTS.switchDeviceDialog));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);
    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceHost: "office-u64" }),
      expect.objectContaining({ context: HEALTH_CHECK_CONTEXTS.switchDeviceDialog }),
    );
    expect(mockRunHealthCheckForTarget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceHost: "backup-u64:8080" }),
      expect.objectContaining({ context: HEALTH_CHECK_CONTEXTS.switchDeviceDialog }),
    );
  });

  it("keeps the previous latest result visible while a rerun is still in progress", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    const previousOfficeResult = result.current.byDeviceId["device-office"]?.latestResult;
    const officeDeferred = createDeferred<ReturnType<typeof makeResult>>();
    const backupDeferred = createDeferred<ReturnType<typeof makeResult>>();

    mockRunHealthCheckForTarget
      .mockImplementationOnce(async () => officeDeferred.promise)
      .mockImplementationOnce(async () => backupDeferred.promise);

    await act(async () => {
      result.current.refreshAll();
    });

    await flushAsyncWork();

    expect(result.current.byDeviceId["device-office"]?.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.latestResult).toBe(previousOfficeResult);
    expect(result.current.byDeviceId["device-office"]?.error).toBeNull();

    await act(async () => {
      officeDeferred.resolve(makeResult("office"));
      backupDeferred.resolve(makeResult("backup"));
    });

    await flushAsyncWork();
  });

  it("keeps the last known result when a superseded cycle is aborted", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    const previousOfficeResult = result.current.byDeviceId["device-office"]?.latestResult;

    mockRunHealthCheckForTarget
      .mockImplementationOnce(createAbortablePendingRun())
      .mockImplementationOnce(createAbortablePendingRun())
      .mockImplementationOnce(async (target: { deviceHost: string }) =>
        target.deviceHost.includes("backup") ? makeResult("backup") : makeResult("office"),
      )
      .mockImplementationOnce(async (target: { deviceHost: string }) =>
        target.deviceHost.includes("backup") ? makeResult("backup") : makeResult("office"),
      );

    await act(async () => {
      result.current.refreshAll();
    });

    await flushAsyncWork();

    expect(result.current.byDeviceId["device-office"]?.running).toBe(true);
    expect(result.current.byDeviceId["device-office"]?.latestResult).toBe(previousOfficeResult);

    await act(async () => {
      result.current.refreshAll();
    });

    await flushAsyncWork();

    expect(result.current.byDeviceId["device-office"]?.error).toBeNull();
    expect(result.current.byDeviceId["device-office"]?.latestResult).not.toBeNull();
    expect(result.current.byDeviceId["device-office"]?.latestResult?.overallHealth).toBe(
      previousOfficeResult?.overallHealth ?? "Healthy",
    );
    expect(result.current.byDeviceId["device-office"]?.latestResult?.overallHealth).not.toBe("Unavailable");
  });

  it("manual refresh forces a new all-device cycle before the next interval", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);

    await act(async () => {
      result.current.refreshAll();
    });

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(4);
  });

  it("defers background refresh work while a foreground saved-device switch is active", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);

    const attemptId = beginSavedDeviceSwitchAttempt({
      fromDeviceId: "device-office",
      toDeviceId: "device-backup",
      routePath: "/play",
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushAsyncWork();

    expect(result.current.cycle.running).toBe(false);
    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);

    completeSavedDeviceSwitchAttempt(attemptId, {
      outcome: "success",
      verification: { ok: true, deviceInfo: null, error: null },
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(4);
  });

  it("cancels an in-flight background cycle when a foreground saved-device switch starts", async () => {
    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    const previousOfficeResult = result.current.byDeviceId["device-office"]?.latestResult;

    mockRunHealthCheckForTarget
      .mockImplementationOnce(createAbortablePendingRun())
      .mockImplementationOnce(createAbortablePendingRun());

    await act(async () => {
      result.current.refreshAll();
    });
    await flushAsyncWork();

    expect(result.current.byDeviceId["device-office"]?.running).toBe(true);

    beginSavedDeviceSwitchAttempt({
      fromDeviceId: "device-office",
      toDeviceId: "device-backup",
      routePath: "/play",
    });
    await flushAsyncWork();

    expect(result.current.cycle.running).toBe(false);
    expect(result.current.byDeviceId["device-office"]?.latestResult).toBe(previousOfficeResult);
    expect(result.current.byDeviceId["device-office"]?.error).toBeNull();
  });

  it("pauses background-maintenance polling while diagnostics suppression is armed", async () => {
    diagnosticsSuppressionMock.setActive(true);

    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).not.toHaveBeenCalled();
    expect(result.current.cycle.running).toBe(false);

    diagnosticsSuppressionMock.setActive(false);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);
  });

  it("preserves terminal probe states after an automatic cycle completes", async () => {
    const finalProbeStates = makeProbeStates();
    mockRunHealthCheckForTarget.mockImplementationOnce(async (_target, options) => {
      options?.onProgress?.({
        liveProbes: {
          REST: { probe: "REST", outcome: "Success", durationMs: 100, reason: null, startMs: 1 },
          FTP: { probe: "FTP", outcome: "Success", durationMs: 100, reason: null, startMs: 2 },
          TELNET: { probe: "TELNET", outcome: "Success", durationMs: 100, reason: null, startMs: 3 },
          CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 100, reason: null, startMs: 4 },
          RASTER: { probe: "RASTER", outcome: "Success", durationMs: 100, reason: null, startMs: 5 },
          JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 100, reason: null, startMs: 6 },
        },
        probeStates: finalProbeStates,
      });
      return makeResult("office");
    });
    mockRunHealthCheckForTarget.mockImplementationOnce(async () => makeResult("backup"));

    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(result.current.byDeviceId["device-office"]?.running).toBe(false);
    expect(result.current.byDeviceId["device-office"]?.probeStates).toEqual(finalProbeStates);
    expect(result.current.byDeviceId["device-office"]?.probeStates.REST.state).toBe("SUCCESS");
    expect(result.current.byDeviceId["device-office"]?.probeStates.CONFIG.state).toBe("SUCCESS");
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

    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

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

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);
  });

  it("switches from live polling to seeded saved-device state after mount without breaking updates", async () => {
    window.__c64uDiagnosticsTestBridge = {
      getSavedDeviceHealthSnapshot: () => null,
    } as typeof window.__c64uDiagnosticsTestBridge;

    const savedDevices = buildSavedDevices();
    const { result } = renderHook(() => useSavedDeviceHealthChecks(savedDevices, true));

    await flushAsyncWork();

    expect(mockRunHealthCheckForTarget).toHaveBeenCalledTimes(2);

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
