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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useConnectionState } from '@/hooks/useConnectionState';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { getConfiguredHost, saveConfiguredHostAndRetry } from '@/lib/connection/hostEdit';
import { cn } from '@/lib/utils';
import { wrapUserEvent } from '@/lib/tracing/userTrace';

type Props = {
  className?: string;
};

export function ConnectivityIndicator({ className }: Props) {
  const snapshot = useConnectionState();
  const [open, setOpen] = useState(false);
  const [editingHost, setEditingHost] = useState(false);
  const [hostInput, setHostInput] = useState('');

  const handleClick = () => {
    const configuredHost = getConfiguredHost();
    setHostInput(configuredHost);
    setEditingHost(false);
    setOpen(true);
  };

  const configuredHost = getConfiguredHost();
  const lastAttemptAt = snapshot.lastProbeAtMs;
  const lastSuccessAt = snapshot.lastProbeSucceededAtMs;
  const attemptInFlight = snapshot.state === 'DISCOVERING';
  const lastAttemptSucceeded = useMemo(() => {
    const lastFailureAt = snapshot.lastProbeFailedAtMs;
    if (lastAttemptAt === null) return null;
    if (lastSuccessAt !== null && (lastFailureAt === null || lastSuccessAt >= lastFailureAt)) return true;
    if (lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt)) return false;
    return null;
  }, [lastAttemptAt, lastSuccessAt, snapshot.lastProbeFailedAtMs]);
  const isDemoMode = lastAttemptSucceeded === false;
  const status = attemptInFlight
    ? 'Checking…'
    : lastAttemptSucceeded === true
      ? 'Online'
      : lastAttemptSucceeded === false && lastSuccessAt !== null
        ? 'Offline'
        : 'Not yet connected';
  const communication = status === 'Online'
    ? `Last success ${formatRelative(lastSuccessAt)}`
    : status === 'Offline'
      ? `Last success ${formatRelative(lastSuccessAt)}`
      : lastAttemptAt !== null
        ? `Last attempt ${formatRelative(lastAttemptAt)}`
        : 'No attempts yet';

  const label = isDemoMode ? 'C64U Demo' : 'C64U';
  const showRetryNow = status === 'Offline' || status === 'Not yet connected';
  const saveHostAndRetry = () => {
    saveConfiguredHostAndRetry(hostInput, configuredHost, { trigger: 'settings' });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3" data-testid="connection-status-popover">
        <div className="space-y-1">
          <p
            className={cn(
              'text-sm font-semibold',
              isDemoMode ? 'text-amber-500 indicator-demo' : 'text-success indicator-real',
            )}
          >
            C64U
          </p>
          {isDemoMode ? <p className="text-sm font-semibold text-amber-500 indicator-demo">Demo</p> : null}
        </div>
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Status:</span> {status}</p>
          <div className="space-y-2">
            <p className="break-all">
              <span className="font-medium">Host:</span> {configuredHost}
            </p>
            {editingHost ? (
              <div className="flex items-center gap-2">
                <Input
                  value={hostInput}
                  onChange={(event) => setHostInput(event.target.value)}
                  aria-label="C64U Hostname / IP"
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={saveHostAndRetry}>Save</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditingHost(true)}>
                Change
              </Button>
            )}
          </div>
          <p><span className="font-medium">Communication:</span> {communication}</p>
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
      </PopoverContent>
    </Popover>
  );
}

const formatRelative = (timestampMs: number | null) => {
  if (timestampMs === null) return 'just now';
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (elapsedSeconds < 10) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
};
