import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useC64Categories,
  useC64Connection,
  useC64SetConfig,
} from '@/hooks/useC64Connection';

const mockApi = {
  getInfo: vi.fn(),
  getCategories: vi.fn(),
  setConfigValue: vi.fn(),
};

const updateC64APIConfigMock = vi.fn();
const updateHasChangesMock = vi.fn();

vi.mock('@/lib/c64api', () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfigMock(...args),
  C64_DEFAULTS: { DEFAULT_DEVICE_HOST: 'c64u' },
  getDefaultBaseUrl: () => 'http://default',
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

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
};

describe('useC64Connection', () => {
  beforeEach(() => {
    mockApi.getInfo.mockResolvedValue({ errors: [] });
    mockApi.getCategories.mockResolvedValue({ categories: ['Audio'], errors: [] });
    mockApi.setConfigValue.mockResolvedValue({ errors: [] });
    updateC64APIConfigMock.mockReset();
    updateHasChangesMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    mockApi.getInfo.mockReset();
    mockApi.getCategories.mockReset();
    mockApi.setConfigValue.mockReset();
  });

  it('reports connection status and updates config', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      result.current.updateConfig('http://device', 'pw', 'host');
    });
    expect(updateC64APIConfigMock).toHaveBeenCalledWith('http://device', 'pw', 'host');
    await waitFor(() => expect(result.current.baseUrl).toBe('http://device'));
    expect(result.current.password).toBe('pw');
    expect(result.current.deviceHost).toBe('host');
  });

  it('responds to connection change events', async () => {
    const wrapper = createWrapper();
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
    const wrapper = createWrapper();
    const { result } = renderHook(() => useC64Categories(), { wrapper });

    await waitFor(() => expect(result.current.data?.categories).toEqual(['Audio']));
  });

  it('marks config changes on mutation success', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useC64SetConfig(), { wrapper });

    result.current.mutate({ category: 'Audio', item: 'Volume', value: '0 dB' });
    await waitFor(() => expect(updateHasChangesMock).toHaveBeenCalled());
  });
});
