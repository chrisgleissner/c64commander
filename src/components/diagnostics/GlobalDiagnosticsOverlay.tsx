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
import { discoverConnection } from "@/lib/connection/connectionManager";

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
    setLogs([]);
    setErrorLogs([]);
    setTraceEvents([]);
    toast({ title: "Diagnostics cleared" });
  };

  const handleRetryConnection = () => {
    void discoverConnection("manual");
  };

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
    />
  );
};
