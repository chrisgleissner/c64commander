/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import { resolveLogSeverity, resolveTraceSeverity } from "@/lib/diagnostics/diagnosticsSeverity";
import { DiagnosticsListItem } from "@/components/diagnostics/DiagnosticsListItem";
import { ActionSummaryListItem } from "@/components/diagnostics/ActionSummaryListItem";
import type { DiagnosticsTabKey } from "@/lib/diagnostics/diagnosticsOverlay";

type DiagnosticsLogEntry = {
  id: string;
  level?: string;
  message: string;
  timestamp: string;
  details?: unknown;
};

type DiagnosticsTraceEntry = {
  id: string;
  timestamp: string;
  [key: string]: unknown;
};

type DiagnosticsActionSummary = {
  correlationId: string;
  actionName: string;
  origin?: string;
  originalOrigin?: string;
  outcome?: string;
  startTimestamp: string;
  durationMs: number | null;
  [key: string]: unknown;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diagnosticsTab: DiagnosticsTabKey;
  onDiagnosticsTabChange: (tab: DiagnosticsTabKey) => void;
  diagnosticsFilters: Record<DiagnosticsTabKey, string>;
  onDiagnosticsFilterChange: (tab: DiagnosticsTabKey, value: string) => void;
  logs: DiagnosticsLogEntry[];
  errorLogs: DiagnosticsLogEntry[];
  traceEvents: DiagnosticsTraceEntry[];
  actionSummaries: DiagnosticsActionSummary[];
  onShareCurrentTab: () => void | Promise<void>;
  onShareAll: () => void | Promise<void>;
  onClearAll: () => void;
};

const diagnosticsTabTriggerClass =
  "border border-transparent data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm";

const normalizeDiagnosticsFilter = (value: string) => value.trim().toLowerCase();

const matchesDiagnosticsFilter = (filterText: string, fields: Array<string | null | undefined>) => {
  const normalized = normalizeDiagnosticsFilter(filterText);
  if (!normalized) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(normalized);
};

export function DiagnosticsDialog({
  open,
  onOpenChange,
  diagnosticsTab,
  onDiagnosticsTabChange,
  diagnosticsFilters,
  onDiagnosticsFilterChange,
  logs,
  errorLogs,
  traceEvents,
  actionSummaries,
  onShareCurrentTab,
  onShareAll,
  onClearAll,
}: Props) {
  const activeDiagnosticsFilter = diagnosticsFilters[diagnosticsTab] ?? "";

  const filteredErrorLogs = useMemo(() => {
    const filterText = diagnosticsFilters["error-logs"] ?? "";
    if (!normalizeDiagnosticsFilter(filterText)) return errorLogs;
    return errorLogs.filter((entry) =>
      matchesDiagnosticsFilter(filterText, [
        entry.message,
        formatDiagnosticsTimestamp(entry.timestamp),
        JSON.stringify(entry.details ?? null),
        entry.id,
      ]),
    );
  }, [diagnosticsFilters, errorLogs]);

  const filteredLogs = useMemo(() => {
    const filterText = diagnosticsFilters.logs ?? "";
    if (!normalizeDiagnosticsFilter(filterText)) return logs;
    return logs.filter((entry) =>
      matchesDiagnosticsFilter(filterText, [
        entry.message,
        entry.level,
        formatDiagnosticsTimestamp(entry.timestamp),
        JSON.stringify(entry.details ?? null),
        entry.id,
      ]),
    );
  }, [diagnosticsFilters, logs]);

  const filteredTraces = useMemo(() => {
    const filterText = diagnosticsFilters.traces ?? "";
    if (!normalizeDiagnosticsFilter(filterText)) return traceEvents;
    return traceEvents.filter((entry) =>
      matchesDiagnosticsFilter(filterText, [
        getTraceTitle(entry),
        formatDiagnosticsTimestamp(entry.timestamp),
        JSON.stringify(entry),
        entry.id,
      ]),
    );
  }, [diagnosticsFilters, traceEvents]);

  const filteredActions = useMemo(() => {
    const filterText = diagnosticsFilters.actions ?? "";
    if (!normalizeDiagnosticsFilter(filterText)) return actionSummaries;
    return actionSummaries.filter((summary) => {
      const summaryTime = formatDiagnosticsTimestamp(summary.startTimestamp);
      const durationLabel = summary.durationMs !== null ? `${summary.durationMs} ms` : "Unknown";
      return matchesDiagnosticsFilter(filterText, [
        summary.actionName,
        summary.correlationId,
        summary.origin,
        summary.originalOrigin,
        summary.outcome,
        summaryTime,
        durationLabel,
        JSON.stringify(summary),
      ]);
    });
  }, [actionSummaries, diagnosticsFilters]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent surface="secondary-editor" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Diagnostics</DialogTitle>
          <DialogDescription>Review warnings/errors, logs, traces, and action summaries.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void onShareAll()}>
            Share All
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Clear All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent surface="confirmation">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear diagnostics</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently clear all warning/error logs, logs, traces, and actions. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onClearAll} className="bg-destructive text-destructive-foreground">
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Filter entries..."
            value={activeDiagnosticsFilter}
            onChange={(event) => onDiagnosticsFilterChange(diagnosticsTab, event.target.value)}
            className="pl-9 pr-9 h-9"
            data-testid="diagnostics-filter-input"
          />
          {activeDiagnosticsFilter ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDiagnosticsFilterChange(diagnosticsTab, "")}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              aria-label="Clear filter"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <Tabs
          value={diagnosticsTab}
          onValueChange={(value) => onDiagnosticsTabChange(value as DiagnosticsTabKey)}
          className="space-y-3"
        >
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="error-logs" className={diagnosticsTabTriggerClass}>
              Errors
            </TabsTrigger>
            <TabsTrigger value="logs" className={diagnosticsTabTriggerClass}>
              Logs
            </TabsTrigger>
            <TabsTrigger value="traces" className={diagnosticsTabTriggerClass}>
              Traces
            </TabsTrigger>
            <TabsTrigger value="actions" className={diagnosticsTabTriggerClass}>
              Actions
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="error-logs"
            className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total warnings/errors: {errorLogs.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onShareCurrentTab()}
                data-testid="diagnostics-share-errors"
              >
                Share
              </Button>
            </div>
            {filteredErrorLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No warning or error logs recorded.</p>
            ) : (
              filteredErrorLogs.map((entry) => (
                <DiagnosticsListItem
                  key={entry.id}
                  testId={`error-log-${entry.id}`}
                  mode="log"
                  severity={resolveLogSeverity(entry.level)}
                  title={entry.message}
                  timestamp={entry.timestamp}
                >
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground break-words whitespace-normal">{entry.message}</p>
                    {entry.details && (
                      <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </DiagnosticsListItem>
              ))
            )}
          </TabsContent>
          <TabsContent
            value="logs"
            className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total logs: {logs.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onShareCurrentTab()}
                data-testid="diagnostics-share-logs"
              >
                Share
              </Button>
            </div>
            {filteredLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No logs recorded.</p>
            ) : (
              filteredLogs.map((entry) => (
                <DiagnosticsListItem
                  key={entry.id}
                  testId={`log-entry-${entry.id}`}
                  mode="log"
                  severity={resolveLogSeverity(entry.level)}
                  title={entry.message}
                  timestamp={entry.timestamp}
                >
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground break-words whitespace-normal">{entry.message}</p>
                    {entry.details && (
                      <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </DiagnosticsListItem>
              ))
            )}
          </TabsContent>
          <TabsContent
            value="traces"
            className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total traces: {traceEvents.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onShareCurrentTab()}
                data-testid="diagnostics-share-traces"
              >
                Share
              </Button>
            </div>
            {filteredTraces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No traces recorded.</p>
            ) : (
              <>
                {filteredTraces.length > 100 && (
                  <p className="text-xs text-muted-foreground font-medium text-amber-600">
                    Showing last 100 events. Export for full history.
                  </p>
                )}
                {filteredTraces
                  .slice(-100)
                  .reverse()
                  .map((entry) => (
                    <DiagnosticsListItem
                      key={entry.id}
                      testId={`trace-item-${entry.id}`}
                      mode="trace"
                      severity={resolveTraceSeverity(entry)}
                      title={getTraceTitle(entry)}
                      timestamp={entry.timestamp}
                    >
                      <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    </DiagnosticsListItem>
                  ))}
              </>
            )}
          </TabsContent>
          <TabsContent
            value="actions"
            className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total action summaries: {actionSummaries.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onShareCurrentTab()}
                data-testid="diagnostics-share-actions"
              >
                Share
              </Button>
            </div>
            {filteredActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No actions recorded.</p>
            ) : (
              filteredActions
                .slice(-100)
                .reverse()
                .map((summary) => <ActionSummaryListItem key={summary.correlationId} summary={summary} />)
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
