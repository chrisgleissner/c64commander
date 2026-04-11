import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  runHealthCheckForTarget,
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
import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import type { SavedDevice } from "@/lib/savedDevices/store";

const AUTO_REFRESH_MS = 10_000;
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

export function useSavedDeviceHealthChecks(devices: SavedDevice[], enabled: boolean): UseSavedDeviceHealthChecksResult {
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
                deviceHost: buildDeviceHostWithHttpPort(device.host, device.httpPort),
                ftpPort: device.ftpPort,
                telnetPort: device.telnetPort,
                password,
              },
              {
                mode: "passive",
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
              probeStates: resetHealthCheckProbeStates(),
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
              probeStates: resetHealthCheckProbeStates(),
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
    [cancelAll, devices, enabled, updateDevice],
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
    const intervalId = window.setInterval(() => {
      void runCycle(false);
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
      cancelAll("Saved-device switcher closed");
      setCycle((current) => ({ ...current, running: false }));
    };
  }, [cancelAll, devices, enabled, runCycle, seededState]);

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
