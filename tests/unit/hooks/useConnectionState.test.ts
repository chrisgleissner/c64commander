import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const snapshot = {
  state: 'REAL_CONNECTED',
  lastDiscoveryTrigger: null,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null,
  lastProbeSucceededAtMs: null,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  demoInterstitialVisible: false,
};

const connectionMocks = vi.hoisted(() => ({
  subscribeConnection: vi.fn(),
  getConnectionSnapshot: vi.fn(),
}));

const reactMocks = vi.hoisted(() => ({
  useSyncExternalStore: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useSyncExternalStore: (...args: unknown[]) => reactMocks.useSyncExternalStore(...args),
  };
});

vi.mock('@/lib/connection/connectionManager', () => ({
  subscribeConnection: connectionMocks.subscribeConnection,
  getConnectionSnapshot: connectionMocks.getConnectionSnapshot,
}));

import { useConnectionState } from '@/hooks/useConnectionState';

describe('useConnectionState', () => {
  it('delegates to useSyncExternalStore with connection manager hooks', () => {
    connectionMocks.getConnectionSnapshot.mockReturnValue(snapshot);
    reactMocks.useSyncExternalStore.mockReturnValue(snapshot);
    const { result } = renderHook(() => useConnectionState());

    expect(result.current).toEqual(snapshot);
    expect(reactMocks.useSyncExternalStore).toHaveBeenCalledWith(
      connectionMocks.subscribeConnection,
      connectionMocks.getConnectionSnapshot,
      connectionMocks.getConnectionSnapshot,
    );
  });
});
