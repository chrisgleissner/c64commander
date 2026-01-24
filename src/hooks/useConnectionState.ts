import { useSyncExternalStore } from 'react';
import { getConnectionSnapshot, subscribeConnection, type ConnectionSnapshot } from '@/lib/connection/connectionManager';

export function useConnectionState(): ConnectionSnapshot {
  return useSyncExternalStore(subscribeConnection, getConnectionSnapshot, getConnectionSnapshot);
}

