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
import { reportUserError } from "@/lib/uiErrors";
import { clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { clearTraceEvents, getTraceEvents } from "@/lib/tracing/traceSession";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { shareAllDiagnosticsZip, shareDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { resetDiagnosticsActivity } from "@/lib/diagnostics/diagnosticsActivity";
import { consumeDiagnosticsOpenRequest, type DiagnosticsTabKey } from "@/lib/diagnostics/diagnosticsOverlay";
import { setDiagnosticsOverlayActive, withDiagnosticsTraceOverride } from "@/lib/diagnostics/diagnosticsOverlayState";

export const GlobalDiagnosticsOverlay = () => {
  const location = useLocation();
  const trace = useActionTrace("GlobalDiagnosticsOverlay");
  const isSettingsRoute = location.pathname === "/settings";
  const scrollRestoreRef = useRef<number | null>(null);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<DiagnosticsTabKey>("actions");
  const [diagnosticsFilters, setDiagnosticsFilters] = useState<Record<DiagnosticsTabKey, string>>({
    "error-logs": "",
    logs: "",
    traces: "",
    actions: "",
  });
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [traceEvents, setTraceEvents] = useState(getTraceEvents());
  const actionSummaries = useMemo(() => buildActionSummaries(traceEvents), [traceEvents]);
  const activeDiagnosticsFilter = diagnosticsFilters[diagnosticsTab] ?? "";

  const setDiagnosticsDialogOpen = useCallback((open: boolean) => {
    setDiagnosticsOverlayActive(open);
    setLogsDialogOpen(open);
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
    const handler = () => {
      setTraceEvents(getTraceEvents());
    };
    window.addEventListener("c64u-traces-updated", handler);
    return () => window.removeEventListener("c64u-traces-updated", handler);
  }, []);

  useEffect(() => {
    if (isSettingsRoute) return;
    const handleDiagnosticsRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { tab?: DiagnosticsTabKey } | undefined;
      if (!detail?.tab) return;
      setDiagnosticsTab(detail.tab);
      setDiagnosticsDialogOpen(true);
    };
    const pending = consumeDiagnosticsOpenRequest();
    if (pending) {
      setDiagnosticsTab(pending);
      setDiagnosticsDialogOpen(true);
    }
    window.addEventListener("c64u-diagnostics-open-request", handleDiagnosticsRequest);
    return () => window.removeEventListener("c64u-diagnostics-open-request", handleDiagnosticsRequest);
  }, [isSettingsRoute, setDiagnosticsDialogOpen]);

  useEffect(() => {
    if (!isSettingsRoute || !logsDialogOpen) return;
    setDiagnosticsDialogOpen(false);
  }, [isSettingsRoute, logsDialogOpen, setDiagnosticsDialogOpen]);

  useEffect(() => {
    if (logsDialogOpen) {
      scrollRestoreRef.current = window.scrollY;
      return;
    }
    const restoreY = scrollRestoreRef.current;
    if (restoreY === null) return;
    scrollRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo(0, restoreY);
    });
  }, [logsDialogOpen]);

  useEffect(() => {
    return () => setDiagnosticsOverlayActive(false);
  }, []);

  const diagnosticsExportData = useMemo(
    () => ({
      "error-logs": errorLogs,
      logs,
      traces: traceEvents,
      actions: actionSummaries,
    }),
    [actionSummaries, errorLogs, logs, traceEvents],
  );

  const handleShareDiagnostics = trace(async function handleShareDiagnostics() {
    const data = diagnosticsExportData[diagnosticsTab];
    try {
      await shareDiagnosticsZip(diagnosticsTab, data);
    } catch (error) {
      reportUserError({
        operation: "DIAGNOSTICS_EXPORT",
        title: "Unable to share",
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleShareAllDiagnostics = trace(async function handleShareAllDiagnostics() {
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

  const handleClearAllDiagnostics = () => {
    clearLogs();
    clearTraceEvents();
    resetDiagnosticsActivity();
    setLogs([]);
    setErrorLogs([]);
    setTraceEvents([]);
    toast({ title: "Diagnostics cleared" });
  };

  if (isSettingsRoute) return null;

  return (
    <DiagnosticsDialog
      open={logsDialogOpen}
      onOpenChange={setDiagnosticsDialogOpen}
      diagnosticsTab={diagnosticsTab}
      onDiagnosticsTabChange={setDiagnosticsTab}
      diagnosticsFilters={diagnosticsFilters}
      onDiagnosticsFilterChange={(tab, value) =>
        setDiagnosticsFilters((prev) => ({
          ...prev,
          [tab]: value,
        }))
      }
      logs={logs}
      errorLogs={errorLogs}
      traceEvents={traceEvents}
      actionSummaries={actionSummaries}
      onShareCurrentTab={() => withDiagnosticsTraceOverride(handleShareDiagnostics)}
      onShareAll={() => withDiagnosticsTraceOverride(handleShareAllDiagnostics)}
      onClearAll={handleClearAllDiagnostics}
    />
  );
};
