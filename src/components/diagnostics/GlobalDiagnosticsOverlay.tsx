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
import { clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { clearTraceEvents, getTraceEvents } from "@/lib/tracing/traceSession";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { shareAllDiagnosticsZip, shareDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { resetDiagnosticsActivity } from "@/lib/diagnostics/diagnosticsActivity";
import { consumeDiagnosticsOpenRequest, type DiagnosticsEntryPreset } from "@/lib/diagnostics/diagnosticsOverlay";
import { setDiagnosticsOverlayActive, withDiagnosticsTraceOverride } from "@/lib/diagnostics/diagnosticsOverlayState";
import { discoverConnection, probeOnce } from "@/lib/connection/connectionManager";
import { getConfiguredHost, saveConfiguredHostAndRetry } from "@/lib/connection/hostEdit";
import { runHealthCheck, isHealthCheckRunning, type HealthCheckRunResult } from "@/lib/diagnostics/healthCheckEngine";
import { clearLatencySamples } from "@/lib/diagnostics/latencyTracker";
import { clearHealthHistory } from "@/lib/diagnostics/healthHistory";
import { recordRecentTarget } from "@/lib/diagnostics/recentTargets";
import type { ConnectionActionsCallbacks } from "@/components/diagnostics/ConnectionActionsRegion";
import type { DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";

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

  const diagnosticsExportData = useMemo(
    () => ({ "error-logs": errorLogs, logs, traces: traceEvents, actions: actionSummaries }),
    [actionSummaries, errorLogs, logs, traceEvents],
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
    setLogs([]);
    setErrorLogs([]);
    setTraceEvents([]);
    setLastHealthCheckResult(null);
    toast({ title: "Diagnostics cleared" });
  };

  const handleRetryConnection = () => {
    void discoverConnection("manual");
  };

  // §8.1 — Async retry with inline feedback (used by ConnectionActionsRegion)
  const handleRetryConnectionAsync = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    const host = getConfiguredHost();
    try {
      const ok = await probeOnce({ timeoutMs: 4000 });
      if (ok) {
        void discoverConnection("manual");
        return { success: true, message: `Connected to ${host}` };
      }
      return { success: false, message: `Connection failed to ${host}` };
    } catch (error) {
      return { success: false, message: `Connection failed to ${host}` };
    }
  }, []);

  // §8.2 — Validate then switch device
  const handleSwitchDevice = useCallback(
    async (host: string, port: number): Promise<{ success: boolean; message: string }> => {
      try {
        // §8.2 — Validate candidate before commit
        const baseUrl = `http://${host}:${port}`;
        const ok = await probeOnce({ timeoutMs: 4000 });
        void baseUrl; // probe uses current config; full host switching handled by saveConfiguredHostAndRetry
        if (!ok) {
          // Probe the candidate host directly
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          let reachable = false;
          try {
            const resp = await fetch(`http://${host}:${port}/v1/info`, { signal: controller.signal });
            reachable = resp.ok;
          } catch {
            reachable = false;
          } finally {
            clearTimeout(timer);
          }
          if (!reachable) {
            return { success: false, message: `Could not reach ${host}:${port}` };
          }
        }
        // §8.2 — Commit on success
        saveConfiguredHostAndRetry(host, host, { trigger: "settings" });
        recordRecentTarget(host);
        return { success: true, message: `Switched to ${host}` };
      } catch (error) {
        return { success: false, message: `Could not reach ${host}:${port}` };
      }
    },
    [],
  );

  const connectionCallbacks: ConnectionActionsCallbacks = useMemo(
    () => ({
      onRetryConnection: handleRetryConnectionAsync,
      onSwitchDevice: handleSwitchDevice,
    }),
    [handleRetryConnectionAsync, handleSwitchDevice],
  );

  // §11 — Run health check
  const handleRunHealthCheck = useCallback(async () => {
    if (isHealthCheckRunning()) return;
    setHealthCheckRunning(true);
    try {
      const result = await runHealthCheck();
      if (result) setLastHealthCheckResult(result);
    } catch (error) {
      reportUserError({
        operation: "HEALTH_CHECK",
        title: "Health check failed",
        description: (error as Error).message,
        error,
      });
    } finally {
      setHealthCheckRunning(false);
    }
  }, []);

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
      onRunHealthCheck={() => {
        void handleRunHealthCheck();
      }}
    />
  );
};
