/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Loader2, Monitor } from 'lucide-react';
import { useConnectionState } from '@/hooks/useConnectionState';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { cn } from '@/lib/utils';
import { wrapUserEvent } from '@/lib/tracing/userTrace';

type Props = {
  className?: string;
};

export function ConnectivityIndicator({ className }: Props) {
  const { state } = useConnectionState();

  const handleClick = () => {
    void discoverConnection('manual');
  };

  const isReal = state === 'REAL_CONNECTED';
  const isDiscovering = state === 'DISCOVERING';

  const label =
    state === 'DEMO_ACTIVE'
      ? 'C64U Disconnected'
      : state === 'REAL_CONNECTED'
        ? 'C64U Connected'
        : state === 'DISCOVERING'
          ? 'Discovering C64U'
          : state === 'OFFLINE_NO_DEMO'
            ? 'C64U Offline'
            : 'C64U Unknown';

  return (
    <button
      type="button"
      onClick={wrapUserEvent(handleClick, 'click', 'ConnectivityIndicator', { title: label }, 'ConnectivityIndicator')}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border px-3 py-2 touch-none',
        'hover:border-primary/60 transition-colors',
        className,
      )}
      aria-label={label}
      data-testid="connectivity-indicator"
      data-connection-state={state}
    >
      {isDiscovering ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <Monitor
          className={cn('h-5 w-5', isReal ? 'text-success' : 'text-muted-foreground')}
          style={undefined}
          aria-hidden="true"
        />
      )}

      <span
        className={cn(
          'text-xs font-semibold uppercase tracking-wide',
          isReal ? 'text-success' : 'text-muted-foreground',
        )}
        data-testid="connection-status-label"
      >
        C64U
      </span>
    </button>
  );
}

