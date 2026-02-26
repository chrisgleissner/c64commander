/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConnectionDiagnosticsSummary } from '@/hooks/useConnectionDiagnosticsSummary';
import { useConnectionState } from '@/hooks/useConnectionState';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { requestDiagnosticsOpen, type DiagnosticsTabKey } from '@/lib/diagnostics/diagnosticsOverlay';
import type { DiagnosticsSeverity } from '@/lib/diagnostics/connectionStatusDiagnostics';
import { getConfiguredHost, saveConfiguredHostAndRetry } from '@/lib/connection/hostEdit';
import { cn } from '@/lib/utils';
import { wrapUserEvent } from '@/lib/tracing/userTrace';

type Props = {
  className?: string;
};

export function ConnectivityIndicator({ className }: Props) {
  const snapshot = useConnectionState();
  const diagnosticsSummary = useConnectionDiagnosticsSummary();
  const [open, setOpen] = useState(false);
  const [editingHost, setEditingHost] = useState(false);
  const [hostInput, setHostInput] = useState('');
  const configuredHost = getConfiguredHost();

  const handleClick = () => {
    setHostInput(configuredHost);
    setEditingHost(false);
    setOpen(true);
  };

  const lastAttemptAt = snapshot.lastProbeAtMs;
  const lastSuccessAt = snapshot.lastProbeSucceededAtMs;
  const attemptInFlight = snapshot.state === 'DISCOVERING';
  const lastAttemptSucceeded = useMemo(
    () => deriveLastAttemptSucceeded(lastAttemptAt, lastSuccessAt, snapshot.lastProbeFailedAtMs),
    [lastAttemptAt, lastSuccessAt, snapshot.lastProbeFailedAtMs],
  );
  const isDemoMode = lastAttemptSucceeded === false;
  const status = attemptInFlight
    ? 'Checking…'
    : lastAttemptSucceeded === true
      ? 'Online'
      : lastAttemptSucceeded === false && lastSuccessAt !== null
        ? 'Offline'
        : 'Not yet connected';
  const lastRequest = lastAttemptAt !== null ? formatRelative(lastAttemptAt) : 'none yet';

  const label = isDemoMode ? 'C64U Demo' : 'C64U';
  const showRetryNow = status === 'Offline' || status === 'Not yet connected';
  const saveHostAndRetry = () => {
    saveConfiguredHostAndRetry(hostInput, configuredHost, { trigger: 'settings' });
    setOpen(false);
  };
  const openDiagnosticsTab = (tab: DiagnosticsTabKey) => {
    setOpen(false);
    requestDiagnosticsOpen(tab);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={wrapUserEvent(handleClick, 'click', 'ConnectivityIndicator', { title: label }, 'ConnectivityIndicator')}
        className={cn(
          'rounded-lg border border-border px-3 py-2 touch-none text-right',
          'hover:border-primary/60 transition-colors',
          className,
        )}
        aria-label={label}
        data-testid="connectivity-indicator"
        data-connection-state={snapshot.state}
      >
        <span
          className={cn(
            'block text-xs font-semibold uppercase tracking-wide',
            isDemoMode ? 'text-amber-500 indicator-demo' : 'text-success indicator-real',
          )}
          data-testid="connection-status-label"
        >
          C64U
        </span>
        {isDemoMode ? (
          <span className="block text-xs font-semibold tracking-wide text-amber-500 indicator-demo">Demo</span>
        ) : null}
      </button>
      <DialogContent
        className="w-80 p-0"
        closeTestId="connection-status-close"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-4 p-6" data-testid="connection-status-popover">
          <DialogHeader>
            <DialogTitle>Connection Status</DialogTitle>
            <DialogDescription
              className={cn(isDemoMode ? 'text-amber-500 indicator-demo' : 'text-success indicator-real')}
            >
              {isDemoMode ? 'C64U Demo (simulated device)' : 'C64U'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
              <p data-testid="connection-status-row-status" className="min-h-5"><span className="font-medium">Status:</span> {status}</p>
              {editingHost ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={hostInput}
                    onChange={(event) => setHostInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      saveHostAndRetry();
                    }}
                    aria-label="C64U Hostname / IP"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" onClick={saveHostAndRetry}>Save</Button>
                </div>
              ) : (
                <div data-testid="connection-status-row-host" className="flex min-h-5 items-center justify-between gap-2">
                  <span className="break-all"><span className="font-medium">Host:</span> {configuredHost}</span>
                  <Button variant="ghost" className="h-auto shrink-0 py-0 px-2 text-xs leading-5" onClick={() => setEditingHost(true)}>
                    Change
                  </Button>
                </div>
              )}
              <p data-testid="connection-status-row-last-request" className="min-h-5"><span className="font-medium">Last request:</span> {lastRequest}</p>
          </div>
          <div className="space-y-1 text-sm" data-testid="connection-diagnostics-section">
            <p className="font-medium">Diagnostics</p>
            <DiagnosticsRow
              testId="connection-diagnostics-row-rest"
              label="REST"
              total={diagnosticsSummary.rest.total}
              issueCount={diagnosticsSummary.rest.failed}
              totalLabel={pluralize(diagnosticsSummary.rest.total, 'request', 'requests')}
              issueLabel={pluralize(diagnosticsSummary.rest.failed, 'failed', 'failed')}
              relationLabel="of"
              severity={diagnosticsSummary.rest.severity}
              onClick={() => openDiagnosticsTab('actions')}
            />
            <DiagnosticsRow
              testId="connection-diagnostics-row-ftp"
              label="FTP"
              total={diagnosticsSummary.ftp.total}
              issueCount={diagnosticsSummary.ftp.failed}
              totalLabel={pluralize(diagnosticsSummary.ftp.total, 'operation', 'operations')}
              issueLabel={pluralize(diagnosticsSummary.ftp.failed, 'failed', 'failed')}
              relationLabel="of"
              severity={diagnosticsSummary.ftp.severity}
              onClick={() => openDiagnosticsTab('actions')}
            />
            <DiagnosticsRow
              testId="connection-diagnostics-row-log-issues"
              label="Logs"
              total={diagnosticsSummary.logIssues.total}
              issueCount={diagnosticsSummary.logIssues.issues}
              totalLabel={pluralize(diagnosticsSummary.logIssues.total, 'log', 'logs')}
              issueLabel={pluralize(diagnosticsSummary.logIssues.issues, 'issue', 'issues')}
              relationLabel="in"
              severity={diagnosticsSummary.logIssues.severity}
              onClick={() => openDiagnosticsTab('error-logs')}
            />
          </div>
          {showRetryNow ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                void discoverConnection('manual');
              }}
            >
              Retry Now
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const formatRelative = (timestampMs: number) => {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const m = Math.floor(elapsedSeconds / 60);
  const s = elapsedSeconds % 60;
  return `${m}m ${s}s ago`;
};

const deriveLastAttemptSucceeded = (
  lastAttemptAt: number | null,
  lastSuccessAt: number | null,
  lastFailureAt: number | null,
) => {
  if (lastAttemptAt === null) return null;
  if (lastSuccessAt !== null && (lastFailureAt === null || lastSuccessAt >= lastFailureAt)) return true;
  if (lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt)) return false;
  return null;
};

type DiagnosticsRowProps = {
  testId: string;
  label: string;
  total: number;
  issueCount: number;
  totalLabel: string;
  issueLabel: string;
  relationLabel: 'of' | 'in';
  severity: DiagnosticsSeverity;
  onClick: () => void;
};

const DiagnosticsRow = ({
  testId,
  label,
  total,
  issueCount,
  totalLabel,
  issueLabel,
  relationLabel,
  severity,
  onClick,
}: DiagnosticsRowProps) => {
  const issueCountClass = resolveSeverityCountClass(severity);
  return (
    <button
      type="button"
      className="w-full py-0 text-left text-sm hover:underline"
      onClick={onClick}
      aria-label={`${label}: ${issueCount} ${issueLabel} of ${total} ${totalLabel} (${severity} severity)`}
      data-testid={testId}
      data-severity={severity}
    >
      <span className="text-foreground">
        {label}: <span className={issueCountClass}>{issueCount}</span>{' '}
        {formatDiagnosticsDetail(relationLabel, total, totalLabel, issueLabel)}
      </span>
    </button>
  );
};

const formatDiagnosticsDetail = (
  relationLabel: 'of' | 'in',
  total: number,
  totalLabel: string,
  issueLabel: string,
) => {
  if (relationLabel === 'in') return `${issueLabel} in ${total} ${totalLabel}`;
  return `of ${total} ${totalLabel} ${issueLabel}`;
};

const pluralize = (count: number, singular: string, plural: string) => (count === 1 ? singular : plural);

const resolveSeverityCountClass = (severity: DiagnosticsSeverity) => {
  if (severity === 'high') return 'text-diagnostics-error font-semibold';
  if (severity === 'medium') return 'text-amber-500 font-semibold';
  if (severity === 'low') return 'text-success font-semibold';
  return 'text-foreground';
};
