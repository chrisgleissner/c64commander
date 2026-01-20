import { Capacitor } from '@capacitor/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addErrorLog } from '@/lib/logging';
import { C64_DEFAULTS, getDefaultBaseUrl, updateC64APIConfig } from '@/lib/c64api';
import {
  DeviceMode,
  getDeviceMode,
  getDeveloperModeEnabled,
  getStoredMockBaseUrl,
  getStoredRealBaseUrl,
  getStoredRealDeviceHost,
  getStoredRealFtpPort,
  setDeviceMode,
  setStoredRealBaseUrl,
  setStoredRealDeviceHost,
  setStoredRealFtpPort,
  clearStoredRealDeviceHost,
  clearStoredRealFtpPort,
  subscribeDeviceMode,
  subscribeDeveloperMode,
} from '@/lib/config/developerModeStore';
import { startMockServer, stopMockServer } from '@/lib/mock/mockServer';
import { getStoredFtpPort, setStoredFtpPort } from '@/lib/ftp/ftpConfig';

type MockModeContextValue = {
  isDeveloperModeEnabled: boolean;
  deviceMode: DeviceMode;
  isMockMode: boolean;
  isMockAvailable: boolean;
  isBusy: boolean;
  mockBaseUrl: string | null;
  enableMockMode: () => Promise<void>;
  disableMockMode: () => Promise<void>;
};

const MockModeContext = createContext<MockModeContextValue | null>(null);

const getStoredPassword = () => localStorage.getItem('c64u_password') || undefined;
const getStoredDeviceHost = () =>
  localStorage.getItem('c64u_device_host') || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
const getMockAvailability = () => {
  try {
    return Boolean((Capacitor as { isNativePlatform?: () => boolean })?.isNativePlatform?.());
  } catch {
    return false;
  }
};

const invalidateC64Queries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0]?.toString().startsWith('c64'),
  });
};

export const MockModeProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const isMockAvailable = getMockAvailability();
  const [isDeveloperModeEnabled, setIsDeveloperModeEnabled] = useState(() =>
    getDeveloperModeEnabled(),
  );
  const [deviceMode, setDeviceModeState] = useState<DeviceMode>(() => getDeviceMode());
  const [mockBaseUrl, setMockBaseUrl] = useState<string | null>(() => getStoredMockBaseUrl());
  const [isBusy, setIsBusy] = useState(false);

  useEffect(
    () => subscribeDeveloperMode(({ enabled }) => setIsDeveloperModeEnabled(enabled)),
    [],
  );

  useEffect(
    () => subscribeDeviceMode(({ mode }) => setDeviceModeState(mode)),
    [],
  );

  const applyConnectionBaseUrl = useCallback(
    (baseUrl: string, deviceHostOverride?: string) => {
      updateC64APIConfig(baseUrl, getStoredPassword(), deviceHostOverride || getStoredDeviceHost());
      invalidateC64Queries(queryClient);
    },
    [queryClient],
  );

  const enableMockMode = useCallback(async () => {
    if (!isMockAvailable) {
      throw new Error('Mock C64U is only available on native platforms.');
    }
    if (deviceMode === 'MOCK_DEVICE') return;
    setIsBusy(true);
    try {
      const currentBaseUrl = localStorage.getItem('c64u_base_url') || getDefaultBaseUrl();
      const currentHost = getStoredDeviceHost();
      const currentFtpPort = getStoredFtpPort();
      setStoredRealBaseUrl(currentBaseUrl);
      setStoredRealDeviceHost(currentHost);
      setStoredRealFtpPort(currentFtpPort);

      const { baseUrl, ftpPort } = await startMockServer();
      const mockHost = '127.0.0.1';
      localStorage.setItem('c64u_device_host', mockHost);
      if (ftpPort) setStoredFtpPort(ftpPort);
      applyConnectionBaseUrl(baseUrl, mockHost);
      setDeviceMode('MOCK_DEVICE');
      setMockBaseUrl(baseUrl);
    } finally {
      setIsBusy(false);
    }
  }, [applyConnectionBaseUrl, deviceMode, isMockAvailable]);

  const disableMockMode = useCallback(async () => {
    if (deviceMode !== 'MOCK_DEVICE') return;
    setIsBusy(true);
    try {
      await stopMockServer();
      const fallbackUrl = getStoredRealBaseUrl() || getDefaultBaseUrl();
      const fallbackHost = getStoredRealDeviceHost() || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
      const fallbackFtpPort = Number(getStoredRealFtpPort() || '') || 21;
      localStorage.setItem('c64u_device_host', fallbackHost);
      setStoredFtpPort(fallbackFtpPort);
      applyConnectionBaseUrl(fallbackUrl, fallbackHost);
      setDeviceMode('REAL_DEVICE');
      setMockBaseUrl(null);
      clearStoredRealDeviceHost();
      clearStoredRealFtpPort();
    } finally {
      setIsBusy(false);
    }
  }, [applyConnectionBaseUrl, deviceMode]);

  useEffect(() => {
    if (!isDeveloperModeEnabled && deviceMode === 'MOCK_DEVICE') {
      stopMockServer()
        .catch((error) => {
          addErrorLog('Mock C64U server shutdown failed', { error: (error as Error).message });
        })
        .finally(() => {
          const fallbackUrl = getStoredRealBaseUrl() || getDefaultBaseUrl();
          const fallbackHost = getStoredRealDeviceHost() || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
          const fallbackFtpPort = Number(getStoredRealFtpPort() || '') || 21;
          localStorage.setItem('c64u_device_host', fallbackHost);
          setStoredFtpPort(fallbackFtpPort);
          applyConnectionBaseUrl(fallbackUrl, fallbackHost);
          setDeviceMode('REAL_DEVICE');
          setMockBaseUrl(null);
          clearStoredRealDeviceHost();
          clearStoredRealFtpPort();
        });
      return;
    }

    if (deviceMode !== 'MOCK_DEVICE') return;
    let cancelled = false;
    setIsBusy(true);
    startMockServer()
      .then(({ baseUrl, ftpPort }) => {
        if (cancelled) return;
        const mockHost = '127.0.0.1';
        localStorage.setItem('c64u_device_host', mockHost);
        if (ftpPort) setStoredFtpPort(ftpPort);
        applyConnectionBaseUrl(baseUrl, mockHost);
        setMockBaseUrl(baseUrl);
      })
      .catch((error) => {
        addErrorLog('Mock C64U server boot failed', { error: (error as Error).message });
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyConnectionBaseUrl, deviceMode, isDeveloperModeEnabled]);

  const value = useMemo<MockModeContextValue>(
    () => ({
      isDeveloperModeEnabled,
      deviceMode,
      isMockMode: deviceMode === 'MOCK_DEVICE',
      isMockAvailable,
      isBusy,
      mockBaseUrl,
      enableMockMode,
      disableMockMode,
    }),
    [
      deviceMode,
      disableMockMode,
      enableMockMode,
      isBusy,
      isDeveloperModeEnabled,
      isMockAvailable,
      mockBaseUrl,
    ],
  );

  return <MockModeContext.Provider value={value}>{children}</MockModeContext.Provider>;
};

export const useMockMode = () => {
  const ctx = useContext(MockModeContext);
  if (!ctx) {
    throw new Error('useMockMode must be used within MockModeProvider');
  }
  return ctx;
};
