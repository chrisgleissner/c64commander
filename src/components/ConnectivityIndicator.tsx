import { Loader2, Monitor } from 'lucide-react';
import { useConnectionState } from '@/hooks/useConnectionState';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { C64U_DEMO_AMBER } from '@/lib/ui/colors';
import { cn } from '@/lib/utils';

type Props = {
  className?: string;
};

export function ConnectivityIndicator({ className }: Props) {
  const { state } = useConnectionState();

  const handleClick = () => {
    void discoverConnection('manual');
  };

  const isDemo = state === 'DEMO_ACTIVE';
  const isReal = state === 'REAL_CONNECTED';
  const isDiscovering = state === 'DISCOVERING';

  const label =
    state === 'DEMO_ACTIVE'
      ? 'C64U Demo'
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
      onClick={handleClick}
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
          style={isDemo ? { color: C64U_DEMO_AMBER } : undefined}
          aria-hidden="true"
        />
      )}

      {isDemo ? (
        <span
          className="flex flex-col leading-none font-mono font-bold text-[10px] uppercase tracking-wide"
          style={{ color: C64U_DEMO_AMBER }}
        >
          <span>C64U</span>
          <span>DEMO</span>
        </span>
      ) : (
        <span
          className={cn(
            'text-xs font-mono font-semibold uppercase tracking-wide',
            isReal ? 'text-success' : 'text-muted-foreground',
          )}
        >
          C64U
        </span>
      )}
    </button>
  );
}

