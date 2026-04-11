/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "@/lib/c64api";
import { getPassword as loadStoredPassword, hasStoredPasswordFlag } from "@/lib/secureStorage";
import { getActiveBaseUrl, updateHasChanges, loadInitialSnapshot } from "@/lib/config/appConfigStore";
import { useConnectionState } from "@/hooks/useConnectionState";
import { invalidateForConnectionSettingsChange } from "@/lib/query/c64QueryInvalidation";
import {
  getInfoRefreshMinIntervalMs,
  shouldRunRateLimited,
  DRIVES_POLL_INTERVAL_MS,
} from "@/lib/query/c64PollingGovernance";
import { addLog } from "@/lib/logging";
import { useDiagnosticsSuppressionActive } from "@/hooks/useDiagnosticsSuppressionActive";
import { useScreenActivity } from "@/hooks/useScreenActivity";
import { isDiagnosticsOverlaySuppressionArmed } from "@/lib/diagnostics/diagnosticsOverlayState";
import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";

export type C64QueryOptions = {
  active?: boolean;
  intent?: InteractionIntent;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
};

export const VISIBLE_C64_QUERY_OPTIONS: C64QueryOptions = {
  intent: "user",
  refetchOnMount: "always",
};

export interface ConnectionStatus {
  state: "UNKNOWN" | "DISCOVERING" | "REAL_CONNECTED" | "DEMO_ACTIVE" | "OFFLINE_NO_DEMO";
  connectionState: "connected" | "disconnected";
  isConnected: boolean;
  isDemo: boolean;
  deviceType: "real" | "demo" | null;
  isConnecting: boolean;
  error: string | null;
  deviceInfo: DeviceInfo | null;
}

export function useC64Connection() {
  const connection = useConnectionState();
  const diagnosticsSuppressionActive = useDiagnosticsSuppressionActive();
  const screenActive = useScreenActivity();
  const [baseUrl, setBaseUrl] = useState(() => {
    const resolvedDeviceHost = resolveDeviceHostFromStorage();
    return buildBaseUrlFromDeviceHost(resolvedDeviceHost);
  });
  const [password, setPassword] = useState("");
  const [deviceHost, setDeviceHost] = useState(() => {
    return resolveDeviceHostFromStorage();
  });
  const queryClient = useQueryClient();
  const lastInfoRefreshAtRef = useRef<number | null>(null);
  const settingsRef = useRef({
    baseUrl,
    password,
    deviceHost,
  });

  useEffect(() => {
    settingsRef.current = {
      baseUrl,
      password,
      deviceHost,
    };
  }, [baseUrl, password, deviceHost]);

  const {
    data: deviceInfo,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["c64-info", baseUrl],
    queryFn: async ({ signal }) => {
      if (isDiagnosticsOverlaySuppressionArmed()) {
        const cached = queryClient.getQueryData<DeviceInfo>(["c64-info", baseUrl]);
        if (cached) {
          return cached;
        }
      }
      const api = getC64API();
      return api.getInfo({
        timeoutMs: 3000,
        signal,
        __c64uIntent: "background",
      });
    },
    enabled:
      screenActive &&
      !diagnosticsSuppressionActive &&
      (connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE"),
    retry: 1,
    retryDelay: 1000,
    staleTime: 30000,
    refetchInterval: !screenActive || diagnosticsSuppressionActive ? false : getInfoRefreshMinIntervalMs(),
  });

  const rateLimitedInfoRefetch = useCallback(() => {
    if (!screenActive || isDiagnosticsOverlaySuppressionArmed()) {
      return;
    }
    const nowMs = Date.now();
    if (!shouldRunRateLimited(lastInfoRefreshAtRef.current, getInfoRefreshMinIntervalMs(), nowMs)) {
      return;
    }
    lastInfoRefreshAtRef.current = nowMs;
    void refetch();
  }, [refetch, screenActive]);

  useEffect(() => {
    if (!diagnosticsSuppressionActive) return;
    void queryClient.cancelQueries({ queryKey: ["c64-info", baseUrl] });
  }, [baseUrl, diagnosticsSuppressionActive, queryClient]);

  useEffect(() => {
    let isMounted = true;
    if (hasStoredPasswordFlag()) {
      void loadStoredPassword().then((value) => {
        if (!isMounted) return;
        setPassword(value || "");
      });
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            baseUrl?: string;
            password?: string;
            deviceHost?: string;
            reason?: string;
          }
        | undefined;
      if (!detail) return;
      const current = settingsRef.current;
      const next = {
        baseUrl: typeof detail.baseUrl === "string" ? detail.baseUrl : current.baseUrl,
        password: typeof detail.password === "string" ? detail.password : current.password,
        deviceHost: typeof detail.deviceHost === "string" ? detail.deviceHost : current.deviceHost,
      };
      const baseUrlChanged = next.baseUrl !== current.baseUrl;
      const passwordChanged = next.password !== current.password;
      const hostChanged = next.deviceHost !== current.deviceHost;
      if (!baseUrlChanged && !passwordChanged && !hostChanged) return;

      if (baseUrlChanged) setBaseUrl(next.baseUrl);
      if (passwordChanged) setPassword(next.password);
      if (hostChanged) setDeviceHost(next.deviceHost);
      settingsRef.current = next;
      if (detail.reason !== "saved-device-switch") {
        invalidateForConnectionSettingsChange(queryClient);
      }
      rateLimitedInfoRefetch();
    };

    window.addEventListener("c64u-connection-change", handler as EventListener);
    return () => {
      isMounted = false;
      window.removeEventListener("c64u-connection-change", handler as EventListener);
    };
  }, [queryClient, rateLimitedInfoRefetch]);

  const updateConfig = useCallback(
    (newDeviceHost: string, newPassword?: string) => {
      const resolvedDeviceHost = normalizeDeviceHost(newDeviceHost);
      const resolvedBaseUrl = buildBaseUrlFromDeviceHost(resolvedDeviceHost);
      const resolvedPassword = newPassword || "";
      const current = settingsRef.current;
      const baseUrlChanged = current.baseUrl !== resolvedBaseUrl;
      const passwordChanged = current.password !== resolvedPassword;
      const hostChanged = current.deviceHost !== resolvedDeviceHost;
      if (!baseUrlChanged && !passwordChanged && !hostChanged) {
        return;
      }

      setBaseUrl(resolvedBaseUrl);
      setPassword(resolvedPassword);
      setDeviceHost(resolvedDeviceHost);
      settingsRef.current = {
        baseUrl: resolvedBaseUrl,
        password: resolvedPassword,
        deviceHost: resolvedDeviceHost,
      };
      updateC64APIConfig(resolvedBaseUrl, newPassword, resolvedDeviceHost);
      invalidateForConnectionSettingsChange(queryClient);
      rateLimitedInfoRefetch();
    },
    [queryClient, rateLimitedInfoRefetch],
  );

  const status: ConnectionStatus = {
    state: connection.state,
    connectionState:
      connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE" ? "connected" : "disconnected",
    isConnected: connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE",
    isDemo: connection.state === "DEMO_ACTIVE",
    deviceType: connection.state === "REAL_CONNECTED" ? "real" : connection.state === "DEMO_ACTIVE" ? "demo" : null,
    isConnecting: connection.state === "DISCOVERING",
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

export function useC64Categories(options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  return useQuery({
    queryKey: ["c64-categories"],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategories({ __c64uIntent: intent });
    },
    enabled: queryActive,
    staleTime: 60000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64Category(category: string, enabled = true, options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  return useQuery({
    queryKey: ["c64-category", category],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategory(category, { __c64uIntent: intent });
    },
    enabled: queryActive && enabled && !!category,
    staleTime: options.staleTime ?? 30000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64ConfigItems(category: string, items: string[], enabled = true, options: C64QueryOptions = {}) {
  const itemKey = items.join("|");
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  const snapshot = loadInitialSnapshot(getC64APIConfigSnapshot().baseUrl);
  const placeholderData = (() => {
    if (!snapshot?.data?.[category]) return undefined;
    const categoryPayload = snapshot.data[category] as Record<string, unknown>;
    const categoryBlock = (categoryPayload as Record<string, unknown>)[category] ?? categoryPayload;
    const itemsBlock = (categoryBlock as { items?: Record<string, unknown> }).items ?? categoryBlock;
    if (!itemsBlock || typeof itemsBlock !== "object") return undefined;
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
    queryKey: ["c64-config-items", category, itemKey],
    queryFn: async () => {
      const api = getC64API();
      return api.getConfigItems(category, items, { __c64uIntent: intent });
    },
    enabled: queryActive && enabled && !!category && items.length > 0,
    placeholderData,
    staleTime: options.staleTime ?? 30000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64AllConfig(options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  const { data: categories } = useC64Categories(options);

  return useQuery({
    queryKey: ["c64-all-config"],
    queryFn: async () => {
      const api = getC64API();
      const cats = await api.getCategories({ __c64uIntent: intent });
      const configs: Record<string, ConfigResponse> = {};

      for (const cat of cats.categories) {
        try {
          configs[cat] = await api.getCategory(cat, { __c64uIntent: intent });
        } catch (catError) {
          // Per-category failures are tolerated; callers can render partial config safely.
          addLog("debug", "Config category fetch failed; partial config in use", {
            category: cat,
            error: (catError as Error).message,
          });
        }
      }

      if (cats.categories.length > 0 && Object.keys(configs).length === 0) {
        throw new Error("Failed to fetch configuration data for all categories");
      }

      return configs;
    },
    enabled: queryActive && !!categories,
    staleTime: 30000,
    refetchOnMount: options.refetchOnMount,
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
      queryClient.invalidateQueries({
        queryKey: ["c64-category", variables.category],
      });
      queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
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
      skipInvalidation,
    }: {
      category: string;
      updates: Record<string, string | number>;
      immediate?: boolean;
      skipInvalidation?: boolean;
    }) => {
      const api = getC64API();
      return api.updateConfigBatch({ [category]: updates }, { immediate });
    },
    onSuccess: (_, variables) => {
      if (variables.skipInvalidation) {
        updateHasChanges(getActiveBaseUrl(), true);
        return;
      }
      queryClient.invalidateQueries({
        queryKey: ["c64-category", variables.category],
      });
      queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
      updateHasChanges(getActiveBaseUrl(), true);
    },
  });
}

export function useC64ConfigItem(category?: string, item?: string, enabled = true, options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  return useQuery({
    queryKey: ["c64-config-item", category, item],
    queryFn: async () => {
      const api = getC64API();
      if (!category || !item) {
        return null;
      }
      return api.getConfigItem(category, item, { __c64uIntent: intent });
    },
    enabled: queryActive && enabled && !!category && !!item,
    staleTime: 30000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64Drives(options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const diagnosticsSuppressionActive = useDiagnosticsSuppressionActive();
  const screenActive = useScreenActivity();
  const queryActive = (options.active ?? true) && screenActive;
  return useQuery({
    queryKey: ["c64-drives"],
    queryFn: async () => {
      const api = getC64API();
      return api.getDrives({ __c64uIntent: intent });
    },
    enabled: queryActive,
    staleTime: options.staleTime ?? 10000,
    refetchOnMount: options.refetchOnMount,
    refetchInterval: !queryActive || diagnosticsSuppressionActive ? false : DRIVES_POLL_INTERVAL_MS,
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
          queryClient.invalidateQueries({ queryKey: ["c64"] });
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
        queryClient.invalidateQueries({ queryKey: ["c64-category"] });
        queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
        updateHasChanges(getActiveBaseUrl(), true);
      },
    }),
    resetConfig: useMutation({
      mutationFn: () => api.resetConfig(),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["c64-category"] });
        queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
        updateHasChanges(getActiveBaseUrl(), true);
      },
    }),
  };
}
