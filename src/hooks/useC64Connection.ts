import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getC64API,
  updateC64APIConfig,
  DeviceInfo,
  CategoriesResponse,
  ConfigResponse,
  DrivesResponse,
  getC64APIConfigSnapshot,
  buildBaseUrlFromDeviceHost,
  normalizeDeviceHost,
  resolveDeviceHostFromStorage,
} from '@/lib/c64api';
import { getPassword as loadStoredPassword, hasStoredPasswordFlag } from '@/lib/secureStorage';
import { getActiveBaseUrl, updateHasChanges, loadInitialSnapshot } from '@/lib/config/appConfigStore';
import { useConnectionState } from '@/hooks/useConnectionState';

export interface ConnectionStatus {
  state: 'UNKNOWN' | 'DISCOVERING' | 'REAL_CONNECTED' | 'DEMO_ACTIVE' | 'OFFLINE_NO_DEMO';
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  deviceInfo: DeviceInfo | null;
}

export function useC64Connection() {
  const connection = useConnectionState();
  const [baseUrl, setBaseUrl] = useState(() => {
    const resolvedDeviceHost = resolveDeviceHostFromStorage();
    return buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  });
  const [password, setPassword] = useState('');
  const [deviceHost, setDeviceHost] = useState(() => {
    return resolveDeviceHostFromStorage();
  });
  const queryClient = useQueryClient();

  const { data: deviceInfo, error, isLoading, refetch } = useQuery({
    queryKey: ['c64-info', baseUrl],
    queryFn: async ({ signal }) => {
      const api = getC64API();
      return api.getInfo({ timeoutMs: 3000, signal, __c64uIntent: 'background' });
    },
    enabled: connection.state === 'REAL_CONNECTED' || connection.state === 'DEMO_ACTIVE',
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
  });

  useEffect(() => {
    let isMounted = true;
    if (hasStoredPasswordFlag()) {
      void loadStoredPassword().then((value) => {
        if (!isMounted) return;
        setPassword(value || '');
      });
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        baseUrl?: string;
        password?: string;
        deviceHost?: string;
      } | undefined;
      if (!detail) return;
      if (detail.baseUrl) setBaseUrl(detail.baseUrl);
      if (typeof detail.password === 'string') setPassword(detail.password);
      if (detail.deviceHost) setDeviceHost(detail.deviceHost);
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0]?.toString().startsWith('c64'),
      });
      refetch();
    };

    window.addEventListener('c64u-connection-change', handler as EventListener);
    return () => {
      isMounted = false;
      window.removeEventListener('c64u-connection-change', handler as EventListener);
    };
  }, [queryClient, refetch]);

  const updateConfig = useCallback((newDeviceHost: string, newPassword?: string) => {
    const resolvedDeviceHost = normalizeDeviceHost(newDeviceHost);
    const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
    setBaseUrl(resolvedBaseUrl);
    setPassword(newPassword || '');
    setDeviceHost(resolvedDeviceHost);
    updateC64APIConfig(resolvedBaseUrl, newPassword, resolvedDeviceHost);
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0]?.toString().startsWith('c64'),
    });
    refetch();
  }, [queryClient, refetch]);

  const status: ConnectionStatus = {
    state: connection.state,
    isConnected: connection.state === 'REAL_CONNECTED' || connection.state === 'DEMO_ACTIVE',
    isConnecting: connection.state === 'DISCOVERING',
    error: error ? (error as Error).message : null,
    deviceInfo: deviceInfo || null,
  };

  const runtimeBaseUrl = getC64APIConfigSnapshot().baseUrl;

  return {
    status,
    baseUrl,
    runtimeBaseUrl,
    password,
    deviceHost,
    updateConfig,
    refetch,
  };
}

export function useC64Categories() {
  return useQuery({
    queryKey: ['c64-categories'],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategories();
    },
    staleTime: 60000,
  });
}

export function useC64Category(category: string, enabled = true) {
  return useQuery({
    queryKey: ['c64-category', category],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategory(category);
    },
    enabled: enabled && !!category,
    staleTime: 30000,
  });
}

export function useC64ConfigItems(category: string, items: string[], enabled = true) {
  const itemKey = items.join('|');
  const snapshot = loadInitialSnapshot(getC64APIConfigSnapshot().baseUrl);
  const placeholderData = (() => {
    if (!snapshot?.data?.[category]) return undefined;
    const categoryPayload = snapshot.data[category] as Record<string, unknown>;
    const categoryBlock = (categoryPayload as Record<string, unknown>)[category] ?? categoryPayload;
    const itemsBlock = (categoryBlock as { items?: Record<string, unknown> }).items ?? categoryBlock;
    if (!itemsBlock || typeof itemsBlock !== 'object') return undefined;
    const selected: Record<string, unknown> = {};
    items.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(itemsBlock, item)) {
        selected[item] = (itemsBlock as Record<string, unknown>)[item];
      }
    });
    if (!Object.keys(selected).length) return undefined;
    return {
      [category]: {
        items: selected,
      },
      errors: [],
    } as ConfigResponse;
  })();
  return useQuery({
    queryKey: ['c64-config-items', category, itemKey],
    queryFn: async () => {
      const api = getC64API();
      return api.getConfigItems(category, items);
    },
    enabled: enabled && !!category && items.length > 0,
    placeholderData,
    staleTime: 30000,
  });
}

export function useC64AllConfig() {
  const { data: categories } = useC64Categories();
  
  return useQuery({
    queryKey: ['c64-all-config'],
    queryFn: async () => {
      const api = getC64API();
      const cats = await api.getCategories();
      const configs: Record<string, ConfigResponse> = {};
      
      for (const cat of cats.categories) {
        try {
          configs[cat] = await api.getCategory(cat);
        } catch (e) {
          console.warn(`Failed to fetch category ${cat}:`, e);
        }
      }
      
      return configs;
    },
    enabled: !!categories,
    staleTime: 30000,
  });
}

export function useC64SetConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ category, item, value }: { category: string; item: string; value: string | number }) => {
      const api = getC64API();
      return api.setConfigValue(category, item, value);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['c64-category', variables.category] });
      queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
      updateHasChanges(getActiveBaseUrl(), true);
    },
  });
}

export function useC64UpdateConfigBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      category,
      updates,
      immediate,
    }: {
      category: string;
      updates: Record<string, string | number>;
      immediate?: boolean;
    }) => {
      const api = getC64API();
      return api.updateConfigBatch({ [category]: updates }, { immediate });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['c64-category', variables.category] });
      queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
      updateHasChanges(getActiveBaseUrl(), true);
    },
  });
}

export function useC64ConfigItem(category?: string, item?: string, enabled = true) {
  return useQuery({
    queryKey: ['c64-config-item', category, item],
    queryFn: async () => {
      const api = getC64API();
      if (!category || !item) {
        return null;
      }
      return api.getConfigItem(category, item);
    },
    enabled: enabled && !!category && !!item,
    staleTime: 30000,
  });
}

export function useC64Drives() {
  return useQuery({
    queryKey: ['c64-drives'],
    queryFn: async () => {
      const api = getC64API();
      return api.getDrives();
    },
    staleTime: 10000,
  });
}

export function useC64MachineControl() {
  const queryClient = useQueryClient();
  const api = getC64API();

  return {
    reset: useMutation({
      mutationFn: () => api.machineReset(),
    }),
    reboot: useMutation({
      mutationFn: () => api.machineReboot(),
      onSuccess: () => {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['c64'] });
        }, 3000);
      },
    }),
    pause: useMutation({
      mutationFn: () => api.machinePause(),
    }),
    resume: useMutation({
      mutationFn: () => api.machineResume(),
    }),
    powerOff: useMutation({
      mutationFn: () => api.machinePowerOff(),
    }),
    menuButton: useMutation({
      mutationFn: () => api.machineMenuButton(),
    }),
    saveConfig: useMutation({
      mutationFn: () => api.saveConfig(),
    }),
    loadConfig: useMutation({
      mutationFn: () => api.loadConfig(),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['c64-category'] });
        queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
        updateHasChanges(getActiveBaseUrl(), true);
      },
    }),
    resetConfig: useMutation({
      mutationFn: () => api.resetConfig(),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['c64-category'] });
        queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
        updateHasChanges(getActiveBaseUrl(), true);
      },
    }),
  };
}
