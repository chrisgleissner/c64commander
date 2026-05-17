import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  HEALTH_CHECK_CONTEXTS,
  runHealthCheckForTarget,
  type HealthCheckRunContext,
  type HealthCheckProbeRecord,
  type HealthCheckProbeType,
  type HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";
import { resetHealthCheckProbeStates, type HealthCheckProbeExecutionState } from "@/lib/diagnostics/healthCheckState";
import {
  DIAGNOSTICS_TEST_SAVED_DEVICE_HEALTH_EVENT,
  type DiagnosticsTestBridge,
  type SavedDeviceHealthSeedState,
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
import type { SavedDevice } from "@/lib/savedDevices/store";
import { getSavedDeviceSwitchSummary } from "@/lib/savedDevices/store";
import { buildSavedDevicePreferredRuntimeHost } from "@/lib/savedDevices/resolvedTarget";

// F-DIAG-1 — saved-device probe cycle frequency.
// Picker open (switchDeviceDialog): every 10 s so health refreshes are visible
// during interaction. Background maintenance (picker closed): every 60 s so
// inactive devices do not generate enough trace traffic to interfere with
// foreground operations or cross-contaminate the active device rollup.
const AUTO_REFRESH_MS_FOREGROUND = 10_000;
const AUTO_REFRESH_MS_BACKGROUND = 60_000;
const TOTAL_PROBE_COUNT = 6;

export type SavedDeviceHealthSnapshot = {
  running: boolean;
  latestResult: HealthCheckRunResult | null;
  liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  probeStates: Record<HealthCheckProbeType, HealthCheckProbeExecutionState>;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
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
  error: null,
});

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

const readSeededSavedDeviceHealthState = (): SavedDeviceHealthSeedState | null => {
  if (typeof window === "undefined") return null;
  return window.__c64uDiagnosticsTestBridge?.getSavedDeviceHealthSnapshot?.() ?? null;
};

export function useSavedDeviceHealthChecks(
  devices: SavedDevice[],
  enabled: boolean,
  context: HealthCheckRunContext = HEALTH_CHECK_CONTEXTS.backgroundMaintenance,
): UseSavedDeviceHealthChecksResult {
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

  const seededResult = useMemo<UseSavedDeviceHealthChecksResult | null>(() => {
    if (!seededState) return null;
    return {
      byDeviceId: mergeDeviceState(seededState.byDeviceId, devices),
      cycle: seededState.cycle,
      refreshAll: noopRefreshAll,
      totalProbeCount: TOTAL_PROBE_COUNT,
    };
  }, [devices, noopRefreshAll, seededState]);

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

  const runCycle = useCallback(
    async (force: boolean) => {
      if (!enabled || devices.length === 0) {
        return;
      }
      if (shouldPauseForForegroundSwitch()) {
        return;
      }
      if (shouldPauseForDiagnosticsSuppression()) {
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
        devices.map(async (device) => {
          const controller = new AbortController();
          controllersRef.current.set(device.id, controller);
          updateDevice(device.id, (current) => ({
            ...current,
            running: true,
            liveProbes: {},
            probeStates: resetHealthCheckProbeStates(),
            lastStartedAt: startedAt,
            error: null,
          }));

          try {
            const password = device.hasPassword ? await getPasswordForDevice(device.id) : null;
            if (cycleTokenRef.current !== cycleToken || controller.signal.aborted) {
              return;
            }

            const result = await runHealthCheckForTarget(
              {
                deviceHost: buildSavedDevicePreferredRuntimeHost(device, getSavedDeviceSwitchSummary(device.id)),
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
      devices,
      enabled,
      shouldPauseForDiagnosticsSuppression,
      shouldPauseForForegroundSwitch,
      updateDevice,
    ],
  );

  const refreshAll = useCallback(() => {
    void runCycle(true);
  }, [runCycle]);

  useEffect(() => {
    if (seededState) {
      return;
    }
    if (!enabled || devices.length === 0) {
      cancelAll("Saved-device switcher closed");
      setCycle((current) => ({ ...current, running: false }));
      return;
    }

    void runCycle(true);
    const intervalMs =
      context === HEALTH_CHECK_CONTEXTS.backgroundMaintenance ? AUTO_REFRESH_MS_BACKGROUND : AUTO_REFRESH_MS_FOREGROUND;
    const intervalId = window.setInterval(() => {
      void runCycle(false);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
      cancelAll("Saved-device switcher closed");
      setCycle((current) => ({ ...current, running: false }));
    };
  }, [cancelAll, context, devices, enabled, runCycle, seededState]);

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

    return subscribeDiagnosticsSuppression(handleDiagnosticsSuppression);
  }, [cancelAll, context, seededState]);

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
