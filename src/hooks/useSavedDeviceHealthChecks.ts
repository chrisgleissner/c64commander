import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  HEALTH_CHECK_CONTEXTS,
  runConnectivityProbeForTarget,
  runHealthCheckForTarget,
  type HealthCheckRunContext,
  type HealthCheckProbeRecord,
  type HealthCheckProbeType,
  type HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";
import { resetHealthCheckProbeStates, type HealthCheckProbeExecutionState } from "@/lib/diagnostics/healthCheckState";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { getDeviceStateSnapshot } from "@/lib/deviceInteraction/deviceStateStore";
import {
  DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT,
  type DiagnosticsTestBridge,
  type SavedDeviceHealthSeedState,
  type SavedDeviceHealthSeedSnapshot,
} from "@/lib/diagnostics/diagnosticsTestBridge";
import { addLog } from "@/lib/logging";
import { getPasswordForDevice } from "@/lib/secureStorage";
import {
  SAVED_DEVICE_SWITCH_METRICS_EVENT,
  getSavedDeviceSwitchMetricsSnapshot,
  type SavedDeviceSwitchMetricsSnapshot,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";
import {
  isDiagnosticsOverlaySuppressionArmed,
  subscribeDiagnosticsSuppression,
} from "@/lib/diagnostics/diagnosticsOverlayState";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import type { SavedDevice } from "@/lib/savedDevices/store";
import { buildSavedDevicePreferredRuntimeHost } from "@/lib/savedDevices/resolvedTarget";

// F-DIAG-1 — saved-device probe cycle frequency.
// Picker open (switchDeviceDialog): every 10 s so health refreshes are visible
// during interaction.
// Background maintenance (picker closed): selected-device-only, lightweight,
// and freshness-gated. Healthy devices back off aggressively; failing devices
// re-check sooner without fan-out.
const AUTO_REFRESH_MS_FOREGROUND = 10_000;
const MIN_BACKGROUND_FRESHNESS_MS = 5_000;
const MIN_BACKGROUND_HEALTHY_CADENCE_MS = 60_000;
const MIN_BACKGROUND_RECOVERY_CADENCE_MS = 15_000;
const TOTAL_PROBE_COUNT = 6;

type SavedDeviceHealthDeferredReason = "freshness" | "circuit-open" | null;

export type SavedDeviceHealthSnapshot = {
  running: boolean;
  latestResult: HealthCheckRunResult | null;
  liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  probeStates: Record<HealthCheckProbeType, HealthCheckProbeExecutionState>;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastObservedAt: string | null;
  deferredReason: SavedDeviceHealthDeferredReason;
  error: string | null;
};

type CycleSnapshot = {
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
};

type UseSavedDeviceHealthChecksResult = {
  byDeviceId: Record<string, SavedDeviceHealthSnapshot>;
  cycle: CycleSnapshot;
  refreshAll: () => void;
  totalProbeCount: number;
};

declare global {
  interface Window {
    __c64uDiagnosticsTestBridge?: DiagnosticsTestBridge;
  }
}

const buildIdleSnapshot = (): SavedDeviceHealthSnapshot => ({
  running: false,
  latestResult: null,
  liveProbes: null,
  probeStates: resetHealthCheckProbeStates(),
  lastStartedAt: null,
  lastCompletedAt: null,
  lastObservedAt: null,
  deferredReason: null,
  error: null,
});

const maxTimestamp = (...values: Array<number | null | undefined>) =>
  values.reduce<number | null>((latest, value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return latest;
    }
    return latest === null ? value : Math.max(latest, value);
  }, null);

const toIsoTimestamp = (value: number | null) => (value === null ? null : new Date(value).toISOString());

const getBackgroundHealthFreshnessMs = () => {
  const safety = loadDeviceSafetyConfig();
  return Math.max(MIN_BACKGROUND_FRESHNESS_MS, safety.infoCacheMs * 8);
};

const getBackgroundHealthCadenceMs = (mode: "healthy" | "recovery") => {
  const freshnessMs = getBackgroundHealthFreshnessMs();
  return mode === "healthy"
    ? Math.max(MIN_BACKGROUND_HEALTHY_CADENCE_MS, freshnessMs * 6)
    : Math.max(MIN_BACKGROUND_RECOVERY_CADENCE_MS, freshnessMs);
};

const isDocumentHidden = () =>
  typeof document !== "undefined" && (document.visibilityState === "hidden" || document.hidden);

const getBackgroundTrafficEvidence = () => {
  const connection = getConnectionSnapshot();
  const deviceState = getDeviceStateSnapshot();
  const lastSuccessAtMs = maxTimestamp(deviceState.lastSuccessAtMs, connection.lastProbeSucceededAtMs);
  const lastFailureAtMs = maxTimestamp(deviceState.lastFailureAtMs, connection.lastProbeFailedAtMs);
  const lastObservedAtMs = maxTimestamp(lastSuccessAtMs, lastFailureAtMs);
  const circuitOpen = typeof deviceState.circuitOpenUntilMs === "number" && Date.now() < deviceState.circuitOpenUntilMs;
  const failureIsNewest = lastFailureAtMs !== null && lastFailureAtMs >= (lastSuccessAtMs ?? Number.NEGATIVE_INFINITY);

  return {
    connection,
    lastSuccessAtMs,
    lastFailureAtMs,
    lastObservedAtMs,
    lastObservedAt: toIsoTimestamp(lastObservedAtMs),
    isFailure: circuitOpen || failureIsNewest,
    circuitOpen,
    errorMessage: deviceState.lastErrorMessage ?? connection.lastProbeError ?? null,
  };
};

const mergeDeviceState = (
  previous: Record<string, SavedDeviceHealthSnapshot>,
  devices: SavedDevice[],
): Record<string, SavedDeviceHealthSnapshot> => {
  const next: Record<string, SavedDeviceHealthSnapshot> = {};
  devices.forEach((device) => {
    next[device.id] = previous[device.id] ?? buildIdleSnapshot();
  });
  return next;
};

const normalizeSeedSnapshot = (snapshot: SavedDeviceHealthSeedSnapshot): SavedDeviceHealthSnapshot => ({
  ...buildIdleSnapshot(),
  ...snapshot,
  lastObservedAt: snapshot.lastObservedAt ?? snapshot.lastCompletedAt ?? null,
  deferredReason: snapshot.deferredReason ?? null,
});

const mergeSeededDeviceState = (
  previous: Record<string, SavedDeviceHealthSeedSnapshot>,
  devices: SavedDevice[],
): Record<string, SavedDeviceHealthSnapshot> => {
  const next: Record<string, SavedDeviceHealthSnapshot> = {};
  devices.forEach((device) => {
    const seededSnapshot = previous[device.id];
    next[device.id] = seededSnapshot ? normalizeSeedSnapshot(seededSnapshot) : buildIdleSnapshot();
  });
  return next;
};

const readSeededSavedDeviceHealthState = (): SavedDeviceHealthSeedState | null => {
  if (typeof window === "undefined") return null;
  return window.__c64uDiagnosticsTestBridge?.getSavedDeviceHealthSnapshot?.() ?? null;
};

export function useSavedDeviceHealthChecks(
  devices: SavedDevice[],
  enabled: boolean,
  context: HealthCheckRunContext = HEALTH_CHECK_CONTEXTS.backgroundMaintenance,
  selectedDeviceId: string | null = null,
): UseSavedDeviceHealthChecksResult {
  const devicesRef = useRef(devices);
  const [byDeviceId, setByDeviceId] = useState<Record<string, SavedDeviceHealthSnapshot>>(() =>
    mergeDeviceState({}, devices),
  );
  const [cycle, setCycle] = useState<CycleSnapshot>({
    running: false,
    lastStartedAt: null,
    lastCompletedAt: null,
  });
  const [seededState, setSeededState] = useState<SavedDeviceHealthSeedState | null>(() =>
    readSeededSavedDeviceHealthState(),
  );
  const cycleTokenRef = useRef(0);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const cycleRunningRef = useRef(false);

  useEffect(() => {
    const applySeededState = (nextState: SavedDeviceHealthSeedState | null) => {
      setSeededState(nextState);
    };

    applySeededState(readSeededSavedDeviceHealthState());

    const handleSeededState = (event: Event) => {
      applySeededState((event as CustomEvent<SavedDeviceHealthSeedState | null>).detail ?? null);
    };

    window.addEventListener(DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT, handleSeededState as EventListener);
    return () =>
      window.removeEventListener(DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT, handleSeededState as EventListener);
  }, []);

  const noopRefreshAll = useCallback(() => {}, []);

  const shouldPauseForForegroundSwitch = useCallback(() => {
    return (
      context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance &&
      getSavedDeviceSwitchMetricsSnapshot().activeAttemptId !== null
    );
  }, [context]);

  const shouldPauseForDiagnosticsSuppression = useCallback(() => {
    return context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance && isDiagnosticsOverlaySuppressionArmed();
  }, [context]);

  const shouldPauseForPollingPause = useCallback(() => {
    return context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance && pollingPauseRegistry.isPollingPaused();
  }, [context]);

  const shouldPauseForDocumentHidden = useCallback(() => {
    return context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance && isDocumentHidden();
  }, [context]);

  const seededResult = useMemo<UseSavedDeviceHealthChecksResult | null>(() => {
    if (!seededState) return null;
    return {
      byDeviceId: mergeSeededDeviceState(seededState.byDeviceId, devices),
      cycle: seededState.cycle,
      refreshAll: noopRefreshAll,
      totalProbeCount: TOTAL_PROBE_COUNT,
    };
  }, [devices, noopRefreshAll, seededState]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // Verification refreshes mutate lastKnown* metadata on saved devices; keep the
  // scheduler keyed to connection-shaping fields so successful probes do not
  // restart background maintenance immediately.
  const cycleScheduleKey = useMemo(
    () =>
      devices
        .map((device) =>
          [
            device.id,
            device.host,
            device.httpPort,
            device.ftpPort,
            device.telnetPort,
            device.hasPassword ? "password" : "no-password",
          ].join(":"),
        )
        .join("|")
        .concat(`::selected=${selectedDeviceId ?? ""}`),
    [devices, selectedDeviceId],
  );

  useEffect(() => {
    if (seededState) {
      return;
    }
    setByDeviceId((previous) => mergeDeviceState(previous, devices));
  }, [devices, seededState]);

  const updateDevice = useCallback(
    (deviceId: string, updater: (current: SavedDeviceHealthSnapshot) => SavedDeviceHealthSnapshot) => {
      setByDeviceId((previous) => {
        const current = previous[deviceId] ?? buildIdleSnapshot();
        return {
          ...previous,
          [deviceId]: updater(current),
        };
      });
    },
    [],
  );

  const cancelAll = useCallback((reason: string) => {
    cycleTokenRef.current += 1;
    cycleRunningRef.current = false;
    controllersRef.current.forEach((controller) => controller.abort(reason));
    controllersRef.current.clear();
  }, []);

  const runForegroundCycle = useCallback(
    async (force: boolean) => {
      const currentDevices = devicesRef.current;
      if (!enabled || currentDevices.length === 0) {
        return;
      }
      if (shouldPauseForForegroundSwitch()) {
        return;
      }
      if (shouldPauseForDiagnosticsSuppression()) {
        return;
      }
      if (shouldPauseForPollingPause()) {
        return;
      }
      if (cycleRunningRef.current) {
        if (!force) {
          return;
        }
        cancelAll("Superseded by a new saved-device health check cycle");
      }

      const cycleToken = cycleTokenRef.current + 1;
      cycleTokenRef.current = cycleToken;
      cycleRunningRef.current = true;
      const startedAt = new Date().toISOString();
      setCycle((current) => ({
        running: true,
        lastStartedAt: startedAt,
        lastCompletedAt: current.lastCompletedAt,
      }));

      await Promise.allSettled(
        currentDevices.map(async (device) => {
          const controller = new AbortController();
          controllersRef.current.set(device.id, controller);
          updateDevice(device.id, (current) => ({
            ...current,
            running: true,
            liveProbes: {},
            probeStates: resetHealthCheckProbeStates(),
            lastStartedAt: startedAt,
            deferredReason: null,
            error: null,
          }));

          try {
            const password = device.hasPassword ? await getPasswordForDevice(device.id) : null;
            if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
              return;
            }

            const result = await runHealthCheckForTarget(
              {
                deviceHost: buildSavedDevicePreferredRuntimeHost(device),
                ftpPort: device.ftpPort,
                telnetPort: device.telnetPort,
                password,
              },
              {
                context,
                signal: controller.signal,
                onProgress: ({ liveProbes, probeStates }) => {
                  if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
                    return;
                  }
                  updateDevice(device.id, (current) => ({
                    ...current,
                    running: true,
                    liveProbes,
                    probeStates,
                    deferredReason: null,
                    error: null,
                  }));
                },
              },
            );

            if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
              return;
            }

            updateDevice(device.id, (current) => ({
              ...current,
              running: false,
              latestResult: result,
              liveProbes: null,
              probeStates: current.probeStates,
              lastCompletedAt: new Date().toISOString(),
              lastObservedAt: result.endTimestamp,
              deferredReason: null,
              error: null,
            }));
          } catch (error) {
            if (controller.signal.aborted || cycleTokenRef.current !== cycleToken) {
              return;
            }
            const message =
              error instanceof Error ? error.message : String(error ?? "Saved-device health check failed");
            addLog("warn", "Saved-device health check failed", {
              deviceId: device.id,
              host: device.host,
              error: message,
            });
            updateDevice(device.id, (current) => ({
              ...current,
              running: false,
              liveProbes: null,
              probeStates: current.probeStates,
              lastCompletedAt: new Date().toISOString(),
              deferredReason: null,
              error: message,
            }));
          } finally {
            const active = controllersRef.current.get(device.id);
            if (active === controller) {
              controllersRef.current.delete(device.id);
            }
          }
        }),
      );

      if (cycleTokenRef.current !== cycleToken) {
        return;
      }

      cycleRunningRef.current = false;
      setCycle((current) => ({
        running: false,
        lastStartedAt: current.lastStartedAt ?? startedAt,
        lastCompletedAt: new Date().toISOString(),
      }));
    },
    [
      cancelAll,
      context,
      enabled,
      shouldPauseForDiagnosticsSuppression,
      shouldPauseForForegroundSwitch,
      shouldPauseForPollingPause,
      updateDevice,
    ],
  );

  const runBackgroundCycle = useCallback(
    async (force: boolean) => {
      const currentDevices = devicesRef.current;
      if (!enabled || currentDevices.length === 0 || !selectedDeviceId) {
        return getBackgroundHealthCadenceMs("healthy");
      }
      if (shouldPauseForForegroundSwitch()) {
        return getBackgroundHealthCadenceMs("healthy");
      }
      if (shouldPauseForDiagnosticsSuppression()) {
        return getBackgroundHealthCadenceMs("healthy");
      }
      if (shouldPauseForPollingPause()) {
        return getBackgroundHealthCadenceMs("healthy");
      }
      if (shouldPauseForDocumentHidden()) {
        cancelAll("Document hidden");
        setCycle((current) => ({ ...current, running: false }));
        return getBackgroundHealthCadenceMs("healthy");
      }
      if (cycleRunningRef.current) {
        if (!force) {
          return getBackgroundHealthCadenceMs("healthy");
        }
        cancelAll("Superseded by a new saved-device health check cycle");
      }

      const selectedDevice = currentDevices.find((device) => device.id === selectedDeviceId);
      if (!selectedDevice) {
        return getBackgroundHealthCadenceMs("healthy");
      }

      const evidence = getBackgroundTrafficEvidence();
      const freshnessMs = getBackgroundHealthFreshnessMs();
      const hasFreshEvidence =
        evidence.lastObservedAtMs !== null && Date.now() - evidence.lastObservedAtMs < freshnessMs;

      if (evidence.circuitOpen || (!force && hasFreshEvidence)) {
        updateDevice(selectedDevice.id, (current) => ({
          ...current,
          running: false,
          liveProbes: null,
          probeStates: current.probeStates,
          lastObservedAt: evidence.lastObservedAt ?? current.lastObservedAt,
          deferredReason: evidence.circuitOpen ? "circuit-open" : "freshness",
          error: evidence.isFailure ? (evidence.errorMessage ?? current.error) : null,
        }));
        setCycle((current) => ({
          ...current,
          running: false,
          lastCompletedAt: new Date().toISOString(),
        }));
        return getBackgroundHealthCadenceMs(evidence.isFailure ? "recovery" : "healthy");
      }

      const cycleToken = cycleTokenRef.current + 1;
      cycleTokenRef.current = cycleToken;
      cycleRunningRef.current = true;
      const startedAt = new Date().toISOString();
      const controller = new AbortController();
      controllersRef.current.set(selectedDevice.id, controller);

      setCycle((current) => ({
        running: true,
        lastStartedAt: startedAt,
        lastCompletedAt: current.lastCompletedAt,
      }));
      updateDevice(selectedDevice.id, (current) => ({
        ...current,
        running: true,
        liveProbes: null,
        probeStates: resetHealthCheckProbeStates(),
        lastStartedAt: startedAt,
        deferredReason: null,
        error: null,
      }));

      try {
        const password = selectedDevice.hasPassword ? await getPasswordForDevice(selectedDevice.id) : null;
        if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
          return getBackgroundHealthCadenceMs("healthy");
        }

        const result = await runConnectivityProbeForTarget(
          {
            deviceHost: buildSavedDevicePreferredRuntimeHost(selectedDevice),
            ftpPort: selectedDevice.ftpPort,
            telnetPort: selectedDevice.telnetPort,
            password,
          },
          {
            context,
            signal: controller.signal,
          },
        );

        if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
          return getBackgroundHealthCadenceMs("healthy");
        }

        updateDevice(selectedDevice.id, (current) => ({
          ...current,
          running: false,
          latestResult: result,
          liveProbes: null,
          probeStates: current.probeStates,
          lastCompletedAt: result.endTimestamp,
          lastObservedAt: result.endTimestamp,
          deferredReason: null,
          error: result.connectivity === "Offline" ? (result.probes.REST.reason ?? "Device not reachable") : null,
        }));

        return getBackgroundHealthCadenceMs(result.connectivity === "Offline" ? "recovery" : "healthy");
      } catch (error) {
        if (controller.signal.aborted || cycleTokenRef.current !== cycleToken) {
          return getBackgroundHealthCadenceMs("healthy");
        }

        const message = error instanceof Error ? error.message : String(error ?? "Saved-device health check failed");
        addLog("warn", "Saved-device background health check failed", {
          deviceId: selectedDevice.id,
          host: selectedDevice.host,
          error: message,
        });
        updateDevice(selectedDevice.id, (current) => ({
          ...current,
          running: false,
          liveProbes: null,
          probeStates: current.probeStates,
          lastCompletedAt: new Date().toISOString(),
          lastObservedAt: current.lastObservedAt,
          deferredReason: null,
          error: message,
        }));
        return getBackgroundHealthCadenceMs("recovery");
      } finally {
        const active = controllersRef.current.get(selectedDevice.id);
        if (active === controller) {
          controllersRef.current.delete(selectedDevice.id);
        }
        if (cycleTokenRef.current === cycleToken) {
          cycleRunningRef.current = false;
          setCycle((current) => ({
            running: false,
            lastStartedAt: current.lastStartedAt ?? startedAt,
            lastCompletedAt: new Date().toISOString(),
          }));
        }
      }
    },
    [
      cancelAll,
      context,
      enabled,
      selectedDeviceId,
      shouldPauseForDiagnosticsSuppression,
      shouldPauseForForegroundSwitch,
      shouldPauseForPollingPause,
      shouldPauseForDocumentHidden,
      updateDevice,
    ],
  );

  const refreshAll = useCallback(() => {
    if (context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance) {
      void runBackgroundCycle(true);
      return;
    }
    void runForegroundCycle(true);
  }, [context, runBackgroundCycle, runForegroundCycle]);

  useEffect(() => {
    if (seededState) {
      return;
    }
    if (!enabled || devices.length === 0) {
      cancelAll("Saved-device switcher closed");
      setCycle((current) => ({ ...current, running: false }));
      return;
    }

    if (context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance) {
      let cancelled = false;
      let timeoutId: number | null = null;

      const scheduleNext = (delayMs: number) => {
        if (cancelled) {
          return;
        }
        timeoutId = window.setTimeout(() => {
          void runBackgroundCycle(false).then((nextDelayMs) => {
            scheduleNext(nextDelayMs);
          });
        }, delayMs);
      };

      void runBackgroundCycle(true).then((nextDelayMs) => {
        scheduleNext(nextDelayMs);
      });

      return () => {
        cancelled = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        cancelAll("Saved-device switcher closed");
        setCycle((current) => ({ ...current, running: false }));
      };
    }

    void runForegroundCycle(true);
    const intervalId = window.setInterval(() => {
      void runForegroundCycle(false);
    }, AUTO_REFRESH_MS_FOREGROUND);

    return () => {
      window.clearInterval(intervalId);
      cancelAll("Saved-device switcher closed");
      setCycle((current) => ({ ...current, running: false }));
    };
  }, [cancelAll, context, cycleScheduleKey, enabled, runBackgroundCycle, runForegroundCycle, seededState]);

  useEffect(() => {
    if (seededState || context !== HEALTH_CHECK_CONTEXTS.backgroundMaintenance) {
      return;
    }

    const handleSavedDeviceSwitchMetrics = (event: Event) => {
      const detail = (event as CustomEvent<SavedDeviceSwitchMetricsSnapshot>).detail;
      if (!detail?.activeAttemptId) {
        return;
      }
      cancelAll("Foreground saved-device switch in progress");
      setCycle((current) => ({ ...current, running: false }));
    };

    window.addEventListener(SAVED_DEVICE_SWITCH_METRICS_EVENT, handleSavedDeviceSwitchMetrics as EventListener);
    return () =>
      window.removeEventListener(SAVED_DEVICE_SWITCH_METRICS_EVENT, handleSavedDeviceSwitchMetrics as EventListener);
  }, [cancelAll, context, seededState]);

  useEffect(() => {
    if (seededState || context !== HEALTH_CHECK_CONTEXTS.backgroundMaintenance) {
      return;
    }

    const handleDiagnosticsSuppression = (active: boolean) => {
      if (!active) {
        return;
      }
      cancelAll("Diagnostics overlay suppression armed");
      setCycle((current) => ({ ...current, running: false }));
    };

    if (isDiagnosticsOverlaySuppressionArmed()) {
      handleDiagnosticsSuppression(true);
    }

    const unsubscribe = subscribeDiagnosticsSuppression(handleDiagnosticsSuppression);
    return () => {
      unsubscribe?.();
    };
  }, [cancelAll, context, seededState]);

  useEffect(() => {
    if (seededState || context !== HEALTH_CHECK_CONTEXTS.backgroundMaintenance) {
      return;
    }

    const handlePollingPause = () => {
      if (!pollingPauseRegistry.isPollingPaused()) {
        return;
      }
      cancelAll("Polling paused during active interaction");
      setCycle((current) => ({ ...current, running: false }));
    };

    if (pollingPauseRegistry.isPollingPaused()) {
      handlePollingPause();
    }

    return pollingPauseRegistry.subscribe(handlePollingPause);
  }, [cancelAll, context, seededState]);

  useEffect(() => {
    if (seededState || context !== HEALTH_CHECK_CONTEXTS.backgroundMaintenance || typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      if (isDocumentHidden()) {
        cancelAll("Document hidden");
        setCycle((current) => ({ ...current, running: false }));
        return;
      }
      void runBackgroundCycle(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [cancelAll, context, runBackgroundCycle, seededState]);

  return useMemo(
    () =>
      seededResult ?? {
        byDeviceId,
        cycle,
        refreshAll,
        totalProbeCount: TOTAL_PROBE_COUNT,
      },
    [byDeviceId, cycle, refreshAll, seededResult],
  );
}
