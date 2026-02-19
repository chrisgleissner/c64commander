import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ConnectionController } from '@/components/ConnectionController';

const connectionState = {
    value: 'UNKNOWN' as 'UNKNOWN' | 'DISCOVERING' | 'REAL_CONNECTED' | 'DEMO_ACTIVE' | 'OFFLINE_NO_DEMO',
};

const discoverConnectionMock = vi.fn();
const initializeConnectionManagerMock = vi.fn(async () => { });

vi.mock('@/hooks/useConnectionState', () => ({
    useConnectionState: () => ({
        state: connectionState.value,
        lastDiscoveryTrigger: null,
        lastTransitionAtMs: 0,
        lastProbeAtMs: null,
        lastProbeSucceededAtMs: null,
        lastProbeFailedAtMs: null,
        lastProbeError: null,
        demoInterstitialVisible: false,
    }),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
    discoverConnection: (...args: unknown[]) => discoverConnectionMock(...args),
    initializeConnectionManager: () => initializeConnectionManagerMock(),
    getConnectionSnapshot: () => ({
        state: connectionState.value,
        lastDiscoveryTrigger: null,
        lastTransitionAtMs: 0,
        lastProbeAtMs: null,
        lastProbeSucceededAtMs: null,
        lastProbeFailedAtMs: null,
        lastProbeError: null,
        demoInterstitialVisible: false,
    }),
}));

vi.mock('@/lib/c64api', () => ({
    buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? 'c64u'}`,
    resolveDeviceHostFromStorage: () => 'c64u',
}));

vi.mock('@/lib/config/appSettings', () => ({
    loadBackgroundRediscoveryIntervalMs: () => 60_000,
}));

vi.mock('@/lib/secureStorage', () => ({
    getPassword: async () => '',
    hasStoredPasswordFlag: () => false,
}));

describe('ConnectionController', () => {
    beforeEach(() => {
        connectionState.value = 'UNKNOWN';
        discoverConnectionMock.mockReset();
        discoverConnectionMock.mockResolvedValue(undefined);
        initializeConnectionManagerMock.mockReset();
        initializeConnectionManagerMock.mockResolvedValue(undefined);
    });

    it('invalidates only on meaningful connection transitions', async () => {
        const queryClient = new QueryClient();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const view = render(
            <QueryClientProvider client={queryClient}>
                <ConnectionController />
            </QueryClientProvider>,
        );

        expect(invalidateSpy).not.toHaveBeenCalled();

        connectionState.value = 'REAL_CONNECTED';
        view.rerender(
            <QueryClientProvider client={queryClient}>
                <ConnectionController />
            </QueryClientProvider>,
        );

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-info'] });

        const callCountAfterConnect = invalidateSpy.mock.calls.length;

        connectionState.value = 'REAL_CONNECTED';
        view.rerender(
            <QueryClientProvider client={queryClient}>
                <ConnectionController />
            </QueryClientProvider>,
        );
        expect(invalidateSpy.mock.calls.length).toBe(callCountAfterConnect);

        connectionState.value = 'DISCOVERING';
        view.rerender(
            <QueryClientProvider client={queryClient}>
                <ConnectionController />
            </QueryClientProvider>,
        );

        expect(invalidateSpy.mock.calls.length).toBe(callCountAfterConnect + 1);
        expect(invalidateSpy).toHaveBeenLastCalledWith({ queryKey: ['c64-info'] });
    });
});
