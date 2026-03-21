/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { useActionTrace } from "@/hooks/useActionTrace";
import { useHealthState } from "@/hooks/useHealthState";
import { reportUserError } from "@/lib/uiErrors";
import { addErrorLog, clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { clearTraceEvents, getTraceEvents } from "@/lib/tracing/traceSession";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { shareAllDiagnosticsZip, shareDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { resetDiagnosticsActivity } from "@/lib/diagnostics/diagnosticsActivity";
import { consumeDiagnosticsOpenRequest, type DiagnosticsEntryPreset } from "@/lib/diagnostics/diagnosticsOverlay";
import { setDiagnosticsOverlayActive, withDiagnosticsTraceOverride } from "@/lib/diagnostics/diagnosticsOverlayState";
import { discoverConnection } from "@/lib/connection/connectionManager";
import { getConfiguredHost, saveConfiguredHostAndRetry } from "@/lib/connection/hostEdit";
import {
  runHealthCheck,
  isHealthCheckRunning,
  type HealthCheckRunResult,
  type HealthCheckProbeType,
  type HealthCheckProbeRecord,
} from "@/lib/diagnostics/healthCheckEngine";
import { clearLatencySamples, getAllLatencySamples } from "@/lib/diagnostics/latencyTracker";
import { clearHealthHistory, getHealthHistory } from "@/lib/diagnostics/healthHistory";
import { recordRecentTarget } from "@/lib/diagnostics/recentTargets";
import type { ConnectionActionsCallbacks } from "@/components/diagnostics/ConnectionActionsRegion";
import type { DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
import { buildBaseUrlFromDeviceHost, normalizeDeviceHost } from "@/lib/c64api";
import { createActionContext, runWithActionTrace } from "@/lib/tracing/actionTrace";
import { recordRestResponse } from "@/lib/tracing/traceSession";
import { getRecoveryEvidence, clearRecoveryEvidence, recordRecoveryEvidence } from "@/lib/diagnostics/recoveryEvidence";
import {
  DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT,
  type DiagnosticsOverlaySeedState,
} from "@/lib/diagnostics/diagnosticsTestBridge";

const validateTarget = async (host: string, port: number) => {
  const normalizedHost = normalizeDeviceHost(host);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`http://${normalizedHost}:${port}/v1/info`, {
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      normalizedHost,
      body,
      status: response.status,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      normalizedHost,
      body: null,
      status: null,
      durationMs: Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      ),
      errorMessage: (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
};

export const GlobalDiagnosticsOverlay = () => {
  const location = useLocation();
  const trace = useActionTrace("GlobalDiagnosticsOverlay");
  const isSettingsRoute = location.pathname === "/settings";
  const scrollRestoreRef = useRef<number | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const healthState = useHealthState();

  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [traceEvents, setTraceEvents] = useState(getTraceEvents());
  const actionSummaries = useMemo(() => buildActionSummaries(traceEvents), [traceEvents]);

  // §11 — Health check state
  const [healthCheckRunning, setHealthCheckRunning] = useState(false);
  const [lastHealthCheckResult, setLastHealthCheckResult] = useState<HealthCheckRunResult | null>(null);
  const [liveHealthCheckProbes, setLiveHealthCheckProbes] = useState<Partial<
    Record<HealthCheckProbeType, HealthCheckProbeRecord>
  > | null>(null);

  const setDialogOpen = useCallback((open: boolean) => {
    setDiagnosticsOverlayActive(open);
    setOverlayOpen(open);
  }, []);

  useEffect(() => {
    const handler = () => {
      setLogs(getLogs());
      setErrorLogs(getErrorLogs());
    };
    window.addEventListener("c64u-logs-updated", handler);
    return () => window.removeEventListener("c64u-logs-updated", handler);
  }, []);

  useEffect(() => {
    const handler = () => setTraceEvents(getTraceEvents());
    window.addEventListener("c64u-traces-updated", handler);
    return () => window.removeEventListener("c64u-traces-updated", handler);
  }, []);

  useEffect(() => {
    if (isSettingsRoute) return;
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { preset?: DiagnosticsEntryPreset } | undefined;
      if (!detail?.preset) return;
      setDialogOpen(true);
    };
    const pending = consumeDiagnosticsOpenRequest();
    if (pending) {
      setDialogOpen(true);
    }
    window.addEventListener("c64u-diagnostics-open-request", handleRequest);
    return () => window.removeEventListener("c64u-diagnostics-open-request", handleRequest);
  }, [isSettingsRoute, setDialogOpen]);

  useEffect(() => {
    if (!isSettingsRoute || !overlayOpen) return;
    setDialogOpen(false);
  }, [isSettingsRoute, overlayOpen, setDialogOpen]);

  useEffect(() => {
    if (overlayOpen) {
      scrollRestoreRef.current = window.scrollY;
      return;
    }
    const restoreY = scrollRestoreRef.current;
    if (restoreY === null) return;
    scrollRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo(0, restoreY);
    });
  }, [overlayOpen]);

  useEffect(() => {
    return () => setDiagnosticsOverlayActive(false);
  }, []);

  useEffect(() => {
    const applyOverlaySeedState = (state: DiagnosticsOverlaySeedState | null | undefined) => {
      if (!state) return;
      setLastHealthCheckResult(state.lastHealthCheckResult ?? null);
      setLiveHealthCheckProbes(state.liveHealthCheckProbes ?? null);
      setHealthCheckRunning(state.healthCheckRunning ?? false);
    };

    const win = window as Window & {
      __c64uDiagnosticsTestBridge?: {
        getOverlayStateSnapshot?: () => DiagnosticsOverlaySeedState;
      };
    };

    applyOverlaySeedState(win.__c64uDiagnosticsTestBridge?.getOverlayStateSnapshot?.());

    const handleOverlaySeedState = (event: Event) => {
      applyOverlaySeedState((event as CustomEvent<DiagnosticsOverlaySeedState>).detail);
    };

    window.addEventListener(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, handleOverlaySeedState as EventListener);
    return () =>
      window.removeEventListener(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, handleOverlaySeedState as EventListener);
  }, []);

  const diagnosticsExportData = useMemo(
    () => ({
      "error-logs": errorLogs,
      logs,
      traces: traceEvents,
      actions: actionSummaries,
      supplemental: {
        healthSnapshot: healthState,
        lastHealthCheckResult,
        healthHistory: getHealthHistorySnapshot(),
        latencySamples: getAllLatencySamples(),
        recoveryEvidence: getRecoveryEvidence(),
      },
    }),
    [actionSummaries, errorLogs, healthState, lastHealthCheckResult, logs, traceEvents],
  );

  const handleShareAll = trace(async function handleShareAll() {
    try {
      await shareAllDiagnosticsZip(diagnosticsExportData);
    } catch (error) {
      reportUserError({
        operation: "DIAGNOSTICS_EXPORT",
        title: "Unable to share",
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleShareFiltered = trace(async function handleShareFiltered(filteredEntries: unknown[]) {
    try {
      await shareDiagnosticsZip("actions", filteredEntries);
    } catch (error) {
      reportUserError({
        operation: "DIAGNOSTICS_EXPORT",
        title: "Unable to share",
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleClearAll = () => {
    clearLogs();
    clearTraceEvents();
    resetDiagnosticsActivity();
    clearLatencySamples();
    clearHealthHistory();
    clearRecoveryEvidence();
    setLogs([]);
    setErrorLogs([]);
    setTraceEvents([]);
    setLastHealthCheckResult(null);
    toast({ title: "Diagnostics cleared" });
  };

  const handleRetryConnection = () => {
    void discoverConnection("manual");
  };

  // §11 — Run health check
  const handleRunHealthCheck = useCallback(async () => {
    if (isHealthCheckRunning()) return;
    setHealthCheckRunning(true);
    setLiveHealthCheckProbes({});
    try {
      const result = await runHealthCheck((partial) => setLiveHealthCheckProbes(partial));
      if (result) {
        setLastHealthCheckResult(result);
        recordRecoveryEvidence({
          kind: "health-check",
          outcome:
            result.overallHealth === "Unhealthy" || result.overallHealth === "Unavailable" ? "failure" : "success",
          contributor: "App",
          target: healthState.host,
          message: `Health check ${result.overallHealth}`,
        });
      }
    } catch (error) {
      addErrorLog("Health check failed", {
        contributor: "App",
        target: healthState.host,
        probe: "HEALTH_CHECK",
        reason: (error as Error).message,
      });
      reportUserError({
        operation: "HEALTH_CHECK",
        title: "Health check failed",
        description: (error as Error).message,
        error,
      });
    } finally {
      setHealthCheckRunning(false);
      setLiveHealthCheckProbes(null);
    }
  }, [healthState.host]);

  // §8.1 — Async retry with inline feedback (used by ConnectionActionsRegion)
  const handleRetryConnectionAsync = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    const host = getConfiguredHost();
    const action = createActionContext("diagnostics.retry-connection", "user", "GlobalDiagnosticsOverlay");
    try {
      return await runWithActionTrace(action, async () => {
        const result = await validateTarget(host, 80);
        recordRestResponse(action, {
          method: "GET",
          path: "/v1/info",
          url: `${buildBaseUrlFromDeviceHost(result.normalizedHost)}/v1/info`,
          status: result.status,
          headers: {},
          body: result.body,
          payloadPreview: null,
          durationMs: result.durationMs,
          error: result.ok ? null : new Error(result.errorMessage ?? `Connection failed to ${result.normalizedHost}`),
          errorMessage: result.errorMessage,
        });
        if (!result.ok) {
          const message = `Connection failed to ${result.normalizedHost}`;
          addErrorLog(message, {
            contributor: "REST",
            target: result.normalizedHost,
            endpoint: "/v1/info",
            probe: "REST",
            reason: result.errorMessage,
          });
          recordRecoveryEvidence({
            kind: "retry-connection",
            outcome: "failure",
            contributor: "REST",
            target: result.normalizedHost,
            message,
          });
          throw new Error(message);
        }
        recordRecoveryEvidence({
          kind: "retry-connection",
          outcome: "success",
          contributor: "REST",
          target: result.normalizedHost,
          message: `Connected to ${result.normalizedHost}`,
        });
        void discoverConnection("manual");
        void handleRunHealthCheck();
        return { success: true, message: `Connected to ${result.normalizedHost}` };
      });
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }, [handleRunHealthCheck]);

  // §8.2 — Validate then switch device
  const handleSwitchDevice = useCallback(
    async (host: string, port: number): Promise<{ success: boolean; message: string }> => {
      const action = createActionContext("diagnostics.switch-device", "user", "GlobalDiagnosticsOverlay");
      try {
        return await runWithActionTrace(action, async () => {
          const result = await validateTarget(host, port);
          recordRestResponse(action, {
            method: "GET",
            path: "/v1/info",
            url: `http://${result.normalizedHost}:${port}/v1/info`,
            status: result.status,
            headers: {},
            body: result.body,
            payloadPreview: null,
            durationMs: result.durationMs,
            error: result.ok
              ? null
              : new Error(result.errorMessage ?? `Could not reach ${result.normalizedHost}:${port}`),
            errorMessage: result.errorMessage,
          });
          if (!result.ok) {
            const message = `Could not reach ${result.normalizedHost}:${port}`;
            addErrorLog(message, {
              contributor: "REST",
              target: `${result.normalizedHost}:${port}`,
              endpoint: "/v1/info",
              probe: "REST",
              reason: result.errorMessage,
            });
            recordRecoveryEvidence({
              kind: "switch-device",
              outcome: "failure",
              contributor: "REST",
              target: `${result.normalizedHost}:${port}`,
              message,
            });
            throw new Error(message);
          }
          saveConfiguredHostAndRetry(result.normalizedHost, result.normalizedHost, { trigger: "settings" });
          recordRecentTarget(result.normalizedHost);
          recordRecoveryEvidence({
            kind: "switch-device",
            outcome: "success",
            contributor: "REST",
            target: `${result.normalizedHost}:${port}`,
            message: `Switched to ${result.normalizedHost}`,
          });
          void handleRunHealthCheck();
          return { success: true, message: `Switched to ${result.normalizedHost}` };
        });
      } catch (error) {
        return { success: false, message: (error as Error).message };
      }
    },
    [handleRunHealthCheck],
  );

  const connectionCallbacks: ConnectionActionsCallbacks = useMemo(
    () => ({
      onRetryConnection: handleRetryConnectionAsync,
      onSwitchDevice: handleSwitchDevice,
    }),
    [handleRetryConnectionAsync, handleSwitchDevice],
  );

  // §14 — Extract device info from last health check result
  const deviceInfo: DeviceDetailInfo | null = useMemo(() => {
    if (!lastHealthCheckResult?.deviceInfo) return null;
    return lastHealthCheckResult.deviceInfo;
  }, [lastHealthCheckResult]);

  if (isSettingsRoute) return null;

  return (
    <DiagnosticsDialog
      open={overlayOpen}
      onOpenChange={setDialogOpen}
      healthState={healthState}
      logs={logs}
      errorLogs={errorLogs}
      traceEvents={traceEvents}
      actionSummaries={actionSummaries}
      onShareAll={() => withDiagnosticsTraceOverride(handleShareAll)}
      onShareFiltered={(entries) => withDiagnosticsTraceOverride(() => handleShareFiltered(entries))}
      onClearAll={handleClearAll}
      onRetryConnection={handleRetryConnection}
      connectionCallbacks={connectionCallbacks}
      deviceInfo={deviceInfo}
      healthCheckRunning={healthCheckRunning}
      lastHealthCheckResult={lastHealthCheckResult}
      liveHealthCheckProbes={liveHealthCheckProbes}
      onRunHealthCheck={() => {
        void handleRunHealthCheck();
      }}
    />
  );
};

const getHealthHistorySnapshot = () => getHealthHistory();
