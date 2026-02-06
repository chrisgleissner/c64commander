import { motion } from 'framer-motion';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { ConnectionStatus } from '@/hooks/useC64Connection';

interface ConnectionBadgeProps {
  status: ConnectionStatus;
  compact?: boolean;
}

export function ConnectionBadge({ status, compact = false }: ConnectionBadgeProps) {
  const { isConnected, isConnecting, deviceInfo } = status;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        {isConnecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <div className={`status-dot ${isConnected ? 'status-online' : 'status-offline'}`} />
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${isConnected
          ? 'bg-success/10 text-success'
          : isConnecting
            ? 'bg-muted text-muted-foreground'
            : 'bg-destructive/10 text-destructive'
        }`}
    >
      {isConnecting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Connecting...</span>
        </>
      ) : isConnected ? (
        <>
          <Wifi className="h-4 w-4" />
          <span className="font-semibold text-xs">{deviceInfo?.hostname || 'Connected'}</span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Offline</span>
        </>
      )}
    </motion.div>
  );
}
