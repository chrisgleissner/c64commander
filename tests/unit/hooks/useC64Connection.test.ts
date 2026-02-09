/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useC64AllConfig,
  useC64Categories,
  useC64ConfigItem,
  useC64Connection,
  useC64Drives,
  useC64MachineControl,
  useC64SetConfig,
  useC64UpdateConfigBatch,
} from '@/hooks/useC64Connection';

const connectionSnapshot = {
  state: 'REAL_CONNECTED' as const,
  lastDiscoveryTrigger: null as const,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null as number | null,
  lastProbeSucceededAtMs: null as number | null,
  lastProbeFailedAtMs: null as number | null,
  lastProbeError: null as string | null,
  demoInterstitialVisible: false,
};

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => connectionSnapshot,
}));

const mockApi = {
  getInfo: vi.fn(),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getConfigItem: vi.fn(),
  updateConfigBatch: vi.fn(),
  getDrives: vi.fn(),
  setConfigValue: vi.fn(),
  machineReset: vi.fn(),
  machineReboot: vi.fn(),
  machinePause: vi.fn(),
  machineResume: vi.fn(),
  machinePowerOff: vi.fn(),
  machineMenuButton: vi.fn(),
  saveConfig: vi.fn(),
  loadConfig: vi.fn(),
  resetConfig: vi.fn(),
};

const updateC64APIConfigMock = vi.fn();
const updateHasChangesMock = vi.fn();

vi.mock('@/lib/c64api', () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfigMock(...args),
  C64_DEFAULTS: { DEFAULT_DEVICE_HOST: 'c64u' },
  getDefaultBaseUrl: () => 'http://default',
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? 'c64u'}`,
  getDeviceHostFromBaseUrl: (baseUrl?: string) => baseUrl?.replace(/^https?:\/\//, '') ?? 'c64u',
  normalizeDeviceHost: (host?: string) => host?.trim() || 'c64u',
  resolveDeviceHostFromStorage: () => 'c64u',
  getC64APIConfigSnapshot: () => ({
    baseUrl: 'http://default',
    password: undefined,
    deviceHost: 'c64u',
  }),
}));

vi.mock('@/lib/config/appConfigStore', () => ({
  getActiveBaseUrl: () => 'http://default',
  updateHasChanges: (...args: unknown[]) => updateHasChangesMock(...args),
}));

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);

  return { wrapper, client };
};

describe('useC64Connection', () => {
  beforeEach(() => {
    mockApi.getInfo.mockResolvedValue({ errors: [] });
    mockApi.getCategories.mockResolvedValue({ categories: ['Audio'], errors: [] });
    mockApi.getCategory.mockResolvedValue({ Audio: { items: {} }, errors: [] });
    mockApi.getConfigItem.mockResolvedValue({ Audio: { items: { Volume: { selected: '0 dB' } } }, errors: [] });
    mockApi.updateConfigBatch.mockResolvedValue({ errors: [] });
    mockApi.getDrives.mockResolvedValue({ drives: [{ a: { enabled: true } }], errors: [] });
    mockApi.setConfigValue.mockResolvedValue({ errors: [] });
    mockApi.machineReset.mockResolvedValue({ errors: [] });
    mockApi.machineReboot.mockResolvedValue({ errors: [] });
    mockApi.machinePause.mockResolvedValue({ errors: [] });
    mockApi.machineResume.mockResolvedValue({ errors: [] });
    mockApi.machinePowerOff.mockResolvedValue({ errors: [] });
    mockApi.machineMenuButton.mockResolvedValue({ errors: [] });
    mockApi.saveConfig.mockResolvedValue({ errors: [] });
    mockApi.loadConfig.mockResolvedValue({ errors: [] });
    mockApi.resetConfig.mockResolvedValue({ errors: [] });
    updateC64APIConfigMock.mockReset();
    updateHasChangesMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    mockApi.getInfo.mockReset();
    mockApi.getCategories.mockReset();
    mockApi.getCategory.mockReset();
    mockApi.getConfigItem.mockReset();
    mockApi.updateConfigBatch.mockReset();
    mockApi.getDrives.mockReset();
    mockApi.setConfigValue.mockReset();
    mockApi.machineReset.mockReset();
    mockApi.machineReboot.mockReset();
    mockApi.machinePause.mockReset();
    mockApi.machineResume.mockReset();
    mockApi.machinePowerOff.mockReset();
    mockApi.machineMenuButton.mockReset();
    mockApi.saveConfig.mockReset();
    mockApi.loadConfig.mockReset();
    mockApi.resetConfig.mockReset();
  });

  it('reports connection status and updates config', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      result.current.updateConfig('host', 'pw');
    });
    expect(updateC64APIConfigMock).toHaveBeenCalledWith('http://host', 'pw', 'host');
    await waitFor(() => expect(result.current.baseUrl).toBe('http://host'));
    expect(result.current.password).toBe('pw');
    expect(result.current.deviceHost).toBe('host');
  });

  it('responds to connection change events', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('c64u-connection-change', {
          detail: { baseUrl: 'http://event', password: 'evt', deviceHost: 'host' },
        }),
      );
    });

    await waitFor(() => expect(result.current.baseUrl).toBe('http://event'));
  });

  it('fetches categories', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Categories(), { wrapper });

    await waitFor(() => expect(result.current.data?.categories).toEqual(['Audio']));
  });

  it('marks config changes on mutation success', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64SetConfig(), { wrapper });

    result.current.mutate({ category: 'Audio', item: 'Volume', value: '0 dB' });
    await waitFor(() => expect(updateHasChangesMock).toHaveBeenCalled());
  });

  it('fetches all config and tolerates failures', async () => {
    const { wrapper } = createWrapper();
    mockApi.getCategories.mockResolvedValue({ categories: ['Audio', 'Video'], errors: [] });
    mockApi.getCategory.mockImplementation(async (category: string) => {
      if (category === 'Video') {
        throw new Error('fail');
      }
      return { [category]: { items: {} }, errors: [] };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useC64AllConfig(), { wrapper });
    await waitFor(() => expect(result.current.data?.Audio).toBeDefined());
    expect(result.current.data?.Video).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('updates config batch and marks changes', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64UpdateConfigBatch(), { wrapper });

    result.current.mutate({ category: 'Audio', updates: { Volume: '0 dB' } });
    await waitFor(() => expect(updateHasChangesMock).toHaveBeenCalled());
  });

  it('fetches a config item when enabled', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItem('Audio', 'Volume'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApi.getConfigItem).toHaveBeenCalledWith('Audio', 'Volume');
  });

  it('fetches drives', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Drives(), { wrapper });

    await waitFor(() => expect(result.current.data?.drives).toBeDefined());
  });

  it('invalidates and flags config loads and resets', async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useC64MachineControl(), { wrapper });

    await act(async () => {
      await result.current.loadConfig.mutateAsync();
    });
    await act(async () => {
      await result.current.resetConfig.mutateAsync();
    });

    expect(updateHasChangesMock).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-category'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-all-config'] });
  });

  it('invalidates queries after reboot delay', async () => {
    vi.useFakeTimers();
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useC64MachineControl(), { wrapper });

    await act(async () => {
      await result.current.reboot.mutateAsync();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64'] });
    vi.useRealTimers();
  });
});
