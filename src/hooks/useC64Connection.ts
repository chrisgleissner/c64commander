import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getC64API, updateC64APIConfig, DeviceInfo, CategoriesResponse, ConfigResponse, DrivesResponse } from '@/lib/c64api';

export interface ConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  deviceInfo: DeviceInfo | null;
}

export function useC64Connection() {
  const [baseUrl, setBaseUrl] = useState(() => 
    localStorage.getItem('c64u_base_url') || 'http://c64u'
  );
  const [password, setPassword] = useState(() => 
    localStorage.getItem('c64u_password') || ''
  );

  const queryClient = useQueryClient();

  const { data: deviceInfo, error, isLoading, refetch } = useQuery({
    queryKey: ['c64-info', baseUrl],
    queryFn: async () => {
      const api = getC64API();
      return api.getInfo();
    },
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
  });

  const updateConfig = useCallback((newUrl: string, newPassword?: string) => {
    setBaseUrl(newUrl);
    setPassword(newPassword || '');
    updateC64APIConfig(newUrl, newPassword);
    queryClient.invalidateQueries({ queryKey: ['c64'] });
    refetch();
  }, [queryClient, refetch]);

  const status: ConnectionStatus = {
    isConnected: !!deviceInfo && !error,
    isConnecting: isLoading,
    error: error ? (error as Error).message : null,
    deviceInfo: deviceInfo || null,
  };

  return {
    status,
    baseUrl,
    password,
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
    },
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
      },
    }),
    resetConfig: useMutation({
      mutationFn: () => api.resetConfig(),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['c64-category'] });
        queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
      },
    }),
  };
}
