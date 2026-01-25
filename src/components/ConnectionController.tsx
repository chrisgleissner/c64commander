import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectionState } from '@/hooks/useConnectionState';
import { discoverConnection, initializeConnectionManager } from '@/lib/connection/connectionManager';
import { buildBaseUrlFromDeviceHost, normalizeDeviceHost } from '@/lib/c64api';
import { loadBackgroundRediscoveryIntervalMs } from '@/lib/config/appSettings';

const invalidateC64Queries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) && query.queryKey[0]?.toString().startsWith('c64'),
  });
};

export function ConnectionController() {
  const queryClient = useQueryClient();
  const { state } = useConnectionState();
  const backgroundTimerRef = useRef<number | null>(null);
  const lastSettingsRef = useRef<{ baseUrl: string; password: string; deviceHost: string } | null>(null);

  useEffect(() => {
    void initializeConnectionManager().then(() => {
      void discoverConnection('startup');
    });
  }, []);

  useEffect(() => {
    invalidateC64Queries(queryClient);
  }, [queryClient, state]);

  useEffect(() => {
    const clearTimer = () => {
      if (backgroundTimerRef.current) {
        window.clearInterval(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
    };

    if (state !== 'DEMO_ACTIVE' && state !== 'OFFLINE_NO_DEMO') {
      clearTimer();
      return;
    }

    const intervalMs = loadBackgroundRediscoveryIntervalMs();
    clearTimer();
    backgroundTimerRef.current = window.setInterval(() => {
      void discoverConnection('background');
    }, intervalMs);

    return clearTimer;
  }, [state]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { baseUrl?: string; password?: string; deviceHost?: string }
        | undefined;
      if (!detail) return;
      const next = {
        baseUrl: typeof detail.baseUrl === 'string' ? detail.baseUrl : '',
        password: typeof detail.password === 'string' ? detail.password : '',
        deviceHost: typeof detail.deviceHost === 'string' ? detail.deviceHost : '',
      };
      const prev = lastSettingsRef.current;
      lastSettingsRef.current = next;
      if (!prev) return;
      const baseUrlChanged = prev.baseUrl !== next.baseUrl;
      const passwordChanged = prev.password !== next.password;
      const hostChanged = prev.deviceHost !== next.deviceHost;
      if (!baseUrlChanged && !passwordChanged && !hostChanged) return;
      void discoverConnection('settings');
    };

    // Prime the comparison with current persisted settings.
    localStorage.removeItem('c64u_base_url');
    const storedDeviceHost = normalizeDeviceHost(localStorage.getItem('c64u_device_host'));
    lastSettingsRef.current = {
      baseUrl: buildBaseUrlFromDeviceHost(storedDeviceHost),
      password: localStorage.getItem('c64u_password') || '',
      deviceHost: storedDeviceHost,
    };

    window.addEventListener('c64u-connection-change', handler as EventListener);
    return () => window.removeEventListener('c64u-connection-change', handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key !== 'c64u_background_rediscovery_interval_ms') return;
      if (state !== 'DEMO_ACTIVE' && state !== 'OFFLINE_NO_DEMO') return;
      // Restart timer with new interval.
      if (backgroundTimerRef.current) {
        window.clearInterval(backgroundTimerRef.current);
      }
      backgroundTimerRef.current = window.setInterval(() => {
        void discoverConnection('background');
      }, loadBackgroundRediscoveryIntervalMs());
    };

    window.addEventListener('c64u-app-settings-updated', handler as EventListener);
    return () => window.removeEventListener('c64u-app-settings-updated', handler as EventListener);
  }, [state]);

  return null;
}

