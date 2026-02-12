/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { useActionTrace } from '@/hooks/useActionTrace';
import { reportUserError } from '@/lib/uiErrors';
import { clearLogs, getErrorLogs, getLogs } from '@/lib/logging';
import { clearTraceEvents, getTraceEvents } from '@/lib/tracing/traceSession';
import { getTraceTitle } from '@/lib/tracing/traceFormatter';
import { formatDiagnosticsTimestamp } from '@/lib/diagnostics/timeFormat';
import { buildActionSummaries, type FtpEffect, type RestEffect } from '@/lib/diagnostics/actionSummaries';
import { DiagnosticsListItem } from '@/components/diagnostics/DiagnosticsListItem';
import { DiagnosticsTimestamp } from '@/components/diagnostics/DiagnosticsTimestamp';
import { shareDiagnosticsZip } from '@/lib/diagnostics/diagnosticsExport';
import { resetDiagnosticsActivity } from '@/lib/diagnostics/diagnosticsActivity';
import { consumeDiagnosticsOpenRequest, type DiagnosticsTabKey } from '@/lib/diagnostics/diagnosticsOverlay';
import { setDiagnosticsOverlayActive, withDiagnosticsTraceOverride } from '@/lib/diagnostics/diagnosticsOverlayState';
import { resolveActionSeverity, resolveLogSeverity, resolveTraceSeverity } from '@/lib/diagnostics/diagnosticsSeverity';

const diagnosticsTabTriggerClass =
  'border border-transparent data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm';

export const GlobalDiagnosticsOverlay = () => {
  const location = useLocation();
  const trace = useActionTrace('GlobalDiagnosticsOverlay');
  const isSettingsRoute = location.pathname === '/settings';
  const scrollRestoreRef = useRef<number | null>(null);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<DiagnosticsTabKey>('actions');
  const [diagnosticsFilters, setDiagnosticsFilters] = useState<Record<DiagnosticsTabKey, string>>({
    'error-logs': '',
    logs: '',
    traces: '',
    actions: '',
  });
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [traceEvents, setTraceEvents] = useState(getTraceEvents());
  const actionSummaries = useMemo(() => buildActionSummaries(traceEvents), [traceEvents]);
  const activeDiagnosticsFilter = diagnosticsFilters[diagnosticsTab] ?? '';

  const setDiagnosticsDialogOpen = useCallback((open: boolean) => {
    setLogsDialogOpen(open);
    setDiagnosticsOverlayActive(open);
  }, []);

  useEffect(() => {
    const handler = () => {
      setLogs(getLogs());
      setErrorLogs(getErrorLogs());
    };
    window.addEventListener('c64u-logs-updated', handler);
    return () => window.removeEventListener('c64u-logs-updated', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setTraceEvents(getTraceEvents());
    };
    window.addEventListener('c64u-traces-updated', handler);
    return () => window.removeEventListener('c64u-traces-updated', handler);
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
    window.addEventListener('c64u-diagnostics-open-request', handleDiagnosticsRequest);
    return () => window.removeEventListener('c64u-diagnostics-open-request', handleDiagnosticsRequest);
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

  const normalizeDiagnosticsFilter = (value: string) => value.trim().toLowerCase();

  const matchesDiagnosticsFilter = (filterText: string, fields: Array<string | null | undefined>) => {
    const normalized = normalizeDiagnosticsFilter(filterText);
    if (!normalized) return true;
    const haystack = fields.filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalized);
  };

  const filteredErrorLogs = useMemo(() => {
    const filterText = diagnosticsFilters['error-logs'] ?? '';
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
    const filterText = diagnosticsFilters.logs ?? '';
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
    const filterText = diagnosticsFilters.traces ?? '';
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
    const filterText = diagnosticsFilters.actions ?? '';
    if (!normalizeDiagnosticsFilter(filterText)) return actionSummaries;
    return actionSummaries.filter((summary) => {
      const summaryTime = formatDiagnosticsTimestamp(summary.startTimestamp);
      const durationLabel = summary.durationMs !== null ? `${summary.durationMs} ms` : 'Unknown';
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

  const handleShareDiagnostics = trace(async function handleShareDiagnostics() {
    const data =
      diagnosticsTab === 'error-logs'
        ? errorLogs
        : diagnosticsTab === 'logs'
          ? logs
          : diagnosticsTab === 'traces'
            ? traceEvents
            : actionSummaries;
    try {
      await shareDiagnosticsZip(diagnosticsTab, data);
    } catch (error) {
      reportUserError({
        operation: 'DIAGNOSTICS_EXPORT',
        title: 'Unable to share',
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
    toast({ title: 'Diagnostics cleared' });
  };

  if (isSettingsRoute) return null;

  return (
    <Dialog open={logsDialogOpen} onOpenChange={setDiagnosticsDialogOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Diagnostics</DialogTitle>
          <DialogDescription>Review warnings/errors, logs, traces, and action summaries.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">Clear All</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear diagnostics</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently clear all warning/error logs, logs, traces, and actions. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAllDiagnostics} className="bg-destructive text-destructive-foreground">
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
            onChange={(event) =>
              setDiagnosticsFilters((prev) => ({
                ...prev,
                [diagnosticsTab]: event.target.value,
              }))
            }
            className="pl-9 pr-9 h-9"
            data-testid="diagnostics-filter-input"
          />
          {activeDiagnosticsFilter ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDiagnosticsFilters((prev) => ({
                  ...prev,
                  [diagnosticsTab]: '',
                }))
              }
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              aria-label="Clear filter"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <Tabs
          value={diagnosticsTab}
          onValueChange={(value) => setDiagnosticsTab(value as DiagnosticsTabKey)}
          className="space-y-3"
        >
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="error-logs" className={diagnosticsTabTriggerClass}>Errors</TabsTrigger>
            <TabsTrigger value="logs" className={diagnosticsTabTriggerClass}>Logs</TabsTrigger>
            <TabsTrigger value="traces" className={diagnosticsTabTriggerClass}>Traces</TabsTrigger>
            <TabsTrigger value="actions" className={diagnosticsTabTriggerClass}>Actions</TabsTrigger>
          </TabsList>
          <TabsContent value="error-logs" className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total warnings/errors: {errorLogs.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void withDiagnosticsTraceOverride(handleShareDiagnostics)}
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
                    <p className="text-sm font-medium text-foreground break-words whitespace-normal">
                      {entry.message}
                    </p>
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
          <TabsContent value="logs" className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total logs: {logs.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void withDiagnosticsTraceOverride(handleShareDiagnostics)}
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
                    <p className="text-sm font-medium text-foreground break-words whitespace-normal">
                      {entry.message}
                    </p>
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
          <TabsContent value="traces" className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total traces: {traceEvents.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void withDiagnosticsTraceOverride(handleShareDiagnostics)}
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
          <TabsContent value="actions" className="space-y-3 max-h-[calc(100dvh-23rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Total action summaries: {actionSummaries.length}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void withDiagnosticsTraceOverride(handleShareDiagnostics)}
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
                .map((summary) => {
                  const effects = summary.effects ?? [];
                  const restEffects = effects.filter((effect): effect is RestEffect => effect.type === 'REST');
                  const ftpEffects = effects.filter((effect): effect is FtpEffect => effect.type === 'FTP');
                  const durationLabel = summary.durationMs !== null ? `${summary.durationMs} ms` : 'Unknown';
                  const hasEffects = Boolean(summary.restCount || summary.ftpCount || summary.errorCount);
                  return (
                    <DiagnosticsListItem
                      key={summary.correlationId}
                      testId={`action-summary-${summary.correlationId}`}
                      mode="action"
                      severity={resolveActionSeverity(summary.outcome)}
                      title={summary.actionName}
                      timestamp={summary.startTimestamp}
                      origin={summary.origin}
                      secondaryLeft={
                        hasEffects ? (
                          <>
                            {summary.restCount ? (
                              <span
                                data-testid={`action-rest-count-${summary.correlationId}`}
                                className="text-diagnostics-rest text-xs font-medium"
                              >
                                REST×{summary.restCount}
                              </span>
                            ) : null}
                            {summary.ftpCount ? (
                              <span
                                data-testid={`action-ftp-count-${summary.correlationId}`}
                                className="text-diagnostics-ftp text-xs font-medium"
                              >
                                FTP×{summary.ftpCount}
                              </span>
                            ) : null}
                            {summary.errorCount ? (
                              <span
                                data-testid={`action-error-count-${summary.correlationId}`}
                                className="text-diagnostics-error text-xs font-medium"
                              >
                                ERR×{summary.errorCount}
                              </span>
                            ) : null}
                          </>
                        ) : null
                      }
                      secondaryRight={durationLabel}
                    >
                      <div className="space-y-3 text-xs">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <p className="text-muted-foreground">Correlation</p>
                            <p className="font-semibold break-words">{summary.correlationId}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Action</p>
                            <p>{summary.actionName}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Origin</p>
                            <p>
                              {summary.originalOrigin ? `${summary.originalOrigin} -> ${summary.origin}` : summary.origin}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Outcome</p>
                            <p>{summary.outcome}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Start</p>
                            <DiagnosticsTimestamp value={summary.startTimestamp} className="text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-muted-foreground">End</p>
                            <DiagnosticsTimestamp value={summary.endTimestamp} className="text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-muted-foreground">Duration</p>
                            <p>{summary.durationMs !== null ? `${summary.durationMs} ms` : 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Error</p>
                            <p className={summary.errorMessage ? 'text-diagnostics-error' : ''}>{summary.errorMessage ?? 'None'}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold">REST Effects</p>
                          {restEffects.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No REST effects.</p>
                          ) : (
                            restEffects.map((effect, index) => (
                              <div
                                key={`${summary.correlationId}-rest-${index}`}
                                data-testid={`action-rest-effect-${summary.correlationId}-${index}`}
                                className="rounded-md border border-border/70 p-2"
                              >
                                <p className="font-medium">{effect.method} {effect.path}</p>
                                <p className="text-muted-foreground">
                                  target: {effect.target ?? 'unknown'} · status: {effect.status ?? 'unknown'}
                                  {effect.durationMs !== null ? ` · ${effect.durationMs} ms` : ''}
                                </p>
                                {effect.error ? (
                                  <p className="text-diagnostics-error">error: {effect.error}</p>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold">FTP Effects</p>
                          {ftpEffects.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No FTP effects.</p>
                          ) : (
                            ftpEffects.map((effect, index) => (
                              <div
                                key={`${summary.correlationId}-ftp-${index}`}
                                data-testid={`action-ftp-effect-${summary.correlationId}-${index}`}
                                className="rounded-md border border-border/70 p-2"
                              >
                                <p className="font-medium">{effect.operation} {effect.path}</p>
                                <p className="text-muted-foreground">
                                  target: {effect.target ?? 'unknown'} · result: {effect.result ?? 'unknown'}
                                </p>
                                {effect.error ? (
                                  <p className="text-diagnostics-error">error: {effect.error}</p>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </DiagnosticsListItem>
                  );
                })
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
