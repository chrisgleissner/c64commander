import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockModeProvider, useMockMode } from '@/hooks/useMockMode';

const startMockServerMock = vi.fn();
const stopMockServerMock = vi.fn();
const updateC64APIConfigMock = vi.fn();

const state = {
  developerModeEnabled: true,
  deviceMode: 'REAL_DEVICE' as 'REAL_DEVICE' | 'MOCK_DEVICE',
  storedMockBaseUrl: null as string | null,
  storedRealBaseUrl: 'http://real',
  storedRealDeviceHost: 'real-host',
  storedRealFtpPort: '21',
  ftpPort: 21,
};

const devSubs: Array<(payload: { enabled: boolean }) => void> = [];
const modeSubs: Array<(payload: { mode: 'REAL_DEVICE' | 'MOCK_DEVICE' }) => void> = [];

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock('@/lib/mock/mockServer', () => ({
  startMockServer: () => startMockServerMock(),
  stopMockServer: () => stopMockServerMock(),
}));

vi.mock('@/lib/c64api', () => ({
  C64_DEFAULTS: { DEFAULT_DEVICE_HOST: 'c64u' },
  getDefaultBaseUrl: () => 'http://default',
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfigMock(...args),
}));

vi.mock('@/lib/ftp/ftpConfig', () => ({
  getStoredFtpPort: () => state.ftpPort,
  setStoredFtpPort: (value: number) => {
    state.ftpPort = value;
  },
}));

vi.mock('@/lib/config/developerModeStore', () => ({
  DeviceMode: { REAL_DEVICE: 'REAL_DEVICE', MOCK_DEVICE: 'MOCK_DEVICE' },
  getDeveloperModeEnabled: () => state.developerModeEnabled,
  getDeviceMode: () => state.deviceMode,
  getStoredMockBaseUrl: () => state.storedMockBaseUrl,
  getStoredRealBaseUrl: () => state.storedRealBaseUrl,
  getStoredRealDeviceHost: () => state.storedRealDeviceHost,
  getStoredRealFtpPort: () => state.storedRealFtpPort,
  setDeviceMode: (mode: 'REAL_DEVICE' | 'MOCK_DEVICE') => {
    state.deviceMode = mode;
    modeSubs.forEach((cb) => cb({ mode }));
  },
  setStoredRealBaseUrl: (value: string) => {
    state.storedRealBaseUrl = value;
  },
  setStoredRealDeviceHost: (value: string) => {
    state.storedRealDeviceHost = value;
  },
  setStoredRealFtpPort: (value: number) => {
    state.storedRealFtpPort = String(value);
  },
  clearStoredRealDeviceHost: () => {
    state.storedRealDeviceHost = null as unknown as string;
  },
  clearStoredRealFtpPort: () => {
    state.storedRealFtpPort = null as unknown as string;
  },
  subscribeDeveloperMode: (cb: (payload: { enabled: boolean }) => void) => {
    devSubs.push(cb);
    return () => {
      const idx = devSubs.indexOf(cb);
      if (idx >= 0) devSubs.splice(idx, 1);
    };
  },
  subscribeDeviceMode: (cb: (payload: { mode: 'REAL_DEVICE' | 'MOCK_DEVICE' }) => void) => {
    modeSubs.push(cb);
    return () => {
      const idx = modeSubs.indexOf(cb);
      if (idx >= 0) modeSubs.splice(idx, 1);
    };
  },
}));

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MockModeProvider>{children}</MockModeProvider>
    </QueryClientProvider>
  );
};

describe('useMockMode', () => {
  beforeEach(() => {
    localStorage.clear();
    state.deviceMode = 'REAL_DEVICE';
    state.developerModeEnabled = true;
    state.storedMockBaseUrl = null;
    state.storedRealBaseUrl = 'http://real';
    state.storedRealDeviceHost = 'real-host';
    state.storedRealFtpPort = '21';
    state.ftpPort = 21;
    startMockServerMock.mockResolvedValue({ baseUrl: 'http://mock', ftpPort: 2121 });
    stopMockServerMock.mockResolvedValue(undefined);
    updateC64APIConfigMock.mockReset();
  });

  it('enables and disables mock mode', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useMockMode(), { wrapper });

    await act(async () => {
      await result.current.enableMockMode();
    });

    expect(startMockServerMock).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isMockMode).toBe(true));
    expect(result.current.mockBaseUrl).toBe('http://mock');

    await act(async () => {
      await result.current.disableMockMode();
    });

    expect(stopMockServerMock).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isMockMode).toBe(false));
    expect(result.current.mockBaseUrl).toBeNull();
  });
});
