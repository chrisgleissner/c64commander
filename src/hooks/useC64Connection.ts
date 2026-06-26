/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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
  getDrivesPollIntervalMs,
  pollingPauseRegistry,
} from "@/lib/query/c64PollingGovernance";
import { addLog } from "@/lib/logging";
import { useDiagnosticsSuppressionActive } from "@/hooks/useDiagnosticsSuppressionActive";
import { useAppVisibilityState, useScreenActivity } from "@/hooks/useScreenActivity";
import { isDiagnosticsOverlaySuppressionArmed } from "@/lib/diagnostics/diagnosticsOverlayState";
import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import { getDeviceStateSnapshot } from "@/lib/deviceInteraction/deviceStateStore";

export type C64QueryOptions = {
  active?: boolean;
  intent?: InteractionIntent;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
  skipEnrichment?: boolean;
  timeoutMs?: number;
};

export const VISIBLE_C64_QUERY_OPTIONS: C64QueryOptions = {
  intent: "user",
  refetchOnMount: "always",
};

const HEALTH_CHECK_INTERVAL_MS = 60_000;
const BACKGROUND_QUERY_PREFIXES = [
  ["c64-info"],
  ["c64-drives"],
  ["c64-categories"],
  ["c64-category"],
  ["c64-config-item"],
  ["c64-config-items"],
  ["c64-all-config"],
] as const;

const shouldRunScheduledHealthCheck = () => {
  const lastSuccessAtMs = getDeviceStateSnapshot().lastSuccessAtMs;
  if (lastSuccessAtMs === null) return true;
  return Date.now() - lastSuccessAtMs >= HEALTH_CHECK_INTERVAL_MS;
};

const hasDisplayableDeviceInfo = (value: DeviceInfo | null | undefined) =>
  Boolean(
    value &&
    (value.hostname?.trim() ||
      value.product?.trim() ||
      value.firmware_version?.trim() ||
      value.fpga_version?.trim() ||
      value.core_version?.trim() ||
      value.unique_id?.trim()),
  );

// Reads against a real device must wait until the connection has reached a settled
// state (REAL_CONNECTED or DEMO_ACTIVE). During first-run DISCOVERING the default
// target's host has not been chosen by the user yet, so firing Home/config/drives
// queries against the default `c64u` (or any unchosen host) contaminates
// diagnostics, inflates networkSnapshot.failureCount, and can transiently mark the
// eventual selected device DEGRADED (BUG-061). The c64-info query inside
// useC64Connection already gates on the connection state — extend the same gate to
// every other device-touching query.
const useConnectionActive = () => {
  const connection = useConnectionState();
  return connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE";
};

const usePollingPauseState = () => {
  const [pollingPaused, setPollingPaused] = useState(() => pollingPauseRegistry.isPollingPaused());

  useEffect(
    () =>
      pollingPauseRegistry.subscribe(() => {
        setPollingPaused(pollingPauseRegistry.isPollingPaused());
      }),
    [],
  );

  return pollingPaused;
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
  const appVisible = useAppVisibilityState();
  const pollingPaused = usePollingPauseState();
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
  const previousConnectionStateRef = useRef(connection.state);
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
      // Coalesce the scheduled health poll with other recent device traffic: if
      // a request already succeeded within the health-check interval, reuse the
      // cached info instead of firing a redundant poll. This coalescing MUST
      // happen here in the queryFn rather than by returning `false` from
      // refetchInterval based on elapsed time. React Query treats a `false`
      // interval as "stop polling entirely" and only re-arms on a remount /
      // invalidation / reactive option change — a time-based `false` is never
      // re-evaluated, so the health heartbeat silently halts and the badge stays
      // stale (UNHEALTHY) long after the device recovers, until the user
      // navigates. Keeping the interval alive and skipping the network here
      // preserves the coalescing intent without disabling self-healing polling.
      if (!shouldRunScheduledHealthCheck()) {
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
    retry: false,
    staleTime: HEALTH_CHECK_INTERVAL_MS,
    refetchOnMount: "always",
    // Only ever gate the interval on *reactive* state (screenActive,
    // diagnosticsSuppressionActive, pollingPaused) so React Query re-arms it when
    // that state flips back. Never return `false` from a non-reactive (time-based)
    // condition — that permanently tears the interval down. Time-based coalescing
    // lives in the queryFn above.
    refetchInterval:
      !screenActive || diagnosticsSuppressionActive
        ? false
        : () => (pollingPaused ? false : HEALTH_CHECK_INTERVAL_MS),
  });

  const rateLimitedInfoRefetch = useCallback(() => {
    if (!screenActive || pollingPaused || isDiagnosticsOverlaySuppressionArmed()) {
      return;
    }
    const nowMs = Date.now();
    if (!shouldRunRateLimited(lastInfoRefreshAtRef.current, getInfoRefreshMinIntervalMs(), nowMs)) {
      return;
    }
    lastInfoRefreshAtRef.current = nowMs;
    void refetch();
  }, [pollingPaused, refetch, screenActive]);

  useEffect(() => {
    if (!diagnosticsSuppressionActive) return;
    void queryClient.cancelQueries({ queryKey: ["c64-info", baseUrl] });
  }, [baseUrl, diagnosticsSuppressionActive, queryClient]);

  useEffect(() => {
    if (!pollingPaused) return;
    void queryClient.cancelQueries({ queryKey: ["c64-info", baseUrl], type: "active" });
  }, [baseUrl, pollingPaused, queryClient]);

  useEffect(() => {
    if (appVisible) return;
    void Promise.all(
      BACKGROUND_QUERY_PREFIXES.map((queryKey) =>
        queryClient.cancelQueries({
          queryKey: [...queryKey],
          type: "active",
        }),
      ),
    );
  }, [appVisible, queryClient]);

  useEffect(() => {
    const previousState = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connection.state;
    if (previousState === "REAL_CONNECTED" || connection.state !== "REAL_CONNECTED") {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["c64-info"] });
  }, [connection.state, queryClient]);

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

  const effectiveDeviceInfo: DeviceInfo | null = hasDisplayableDeviceInfo(deviceInfo)
    ? (deviceInfo ?? null)
    : (connection.deviceInfo ?? deviceInfo ?? null);

  const status = useMemo<ConnectionStatus>(
    () => ({
      state: connection.state,
      connectionState:
        connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE" ? "connected" : "disconnected",
      isConnected: connection.state === "REAL_CONNECTED" || connection.state === "DEMO_ACTIVE",
      isDemo: connection.state === "DEMO_ACTIVE",
      deviceType: connection.state === "REAL_CONNECTED" ? "real" : connection.state === "DEMO_ACTIVE" ? "demo" : null,
      isConnecting: connection.state === "DISCOVERING",
      error: error ? (error as Error).message : null,
      deviceInfo: effectiveDeviceInfo,
    }),
    [connection.state, effectiveDeviceInfo, error],
  );

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
  const routingEpoch = useConnectionRoutingEpoch();
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const appVisible = useAppVisibilityState();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && (screenActive || !appVisible);
  return useQuery({
    queryKey: ["c64-categories", routingEpoch],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategories({ __c64uIntent: intent, timeoutMs: options.timeoutMs });
    },
    enabled: queryActive && connectionActive,
    staleTime: 60000,
    refetchOnMount: options.refetchOnMount,
    placeholderData: (previousData) => previousData,
  });
}

export function useC64Category(category: string, enabled = true, options: C64QueryOptions = {}) {
  const routingEpoch = useConnectionRoutingEpoch();
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const appVisible = useAppVisibilityState();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && (screenActive || !appVisible);
  return useQuery({
    queryKey: ["c64-category", category, routingEpoch],
    queryFn: async () => {
      const api = getC64API();
      return api.getCategory(category, { __c64uIntent: intent, timeoutMs: options.timeoutMs });
    },
    enabled: queryActive && enabled && !!category && connectionActive,
    staleTime: options.staleTime ?? 30000,
    refetchOnMount: options.refetchOnMount,
    placeholderData: (previousData) => previousData,
  });
}

// Connection "routing epoch": increments whenever the active API routing is
// re-applied (a "c64u-connection-change" event). Establishing a connection
// re-applies the runtime config — sometimes with the SAME host (mock mode
// preserves the localhost base URL) — which bumps the API request generation and
// aborts in-flight reads as "superseded by routing change". React Query does not
// retry those, so config-driven controls (e.g. the Home SID address Select) can
// stay blank under coverage/parallel-shard load. Reads keyed by this epoch get a
// fresh query each time the routing changes, so the post-bump fetch runs against
// the settled host instead of reviving the cancelled one. The c64-info query has
// always self-healed this way because its key includes the base URL; this gives
// config reads the same property without changing any connection behaviour.
let connectionRoutingEpoch = 0;
const connectionRoutingEpochListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("c64u-connection-change", () => {
    connectionRoutingEpoch += 1;
    connectionRoutingEpochListeners.forEach((listener) => listener());
  });
}
const subscribeConnectionRoutingEpoch = (onChange: () => void) => {
  connectionRoutingEpochListeners.add(onChange);
  return () => connectionRoutingEpochListeners.delete(onChange);
};
const getConnectionRoutingEpoch = () => connectionRoutingEpoch;
export const useConnectionRoutingEpoch = () =>
  useSyncExternalStore(subscribeConnectionRoutingEpoch, getConnectionRoutingEpoch, getConnectionRoutingEpoch);

export function useC64ConfigItems(category: string, items: string[], enabled = true, options: C64QueryOptions = {}) {
  const itemKey = items.join("|");
  const routingEpoch = useConnectionRoutingEpoch();
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const appVisible = useAppVisibilityState();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && (screenActive || !appVisible);
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
    // routingEpoch is appended (not prepended) so prefix-based invalidation —
    // ["c64-config-items"] and ["c64-config-items", category] — still matches.
    queryKey: ["c64-config-items", category, itemKey, routingEpoch],
    queryFn: async () => {
      const api = getC64API();
      return api.getConfigItems(category, items, {
        __c64uIntent: intent,
        __c64uSkipItemEnrichment: options.skipEnrichment,
        timeoutMs: options.timeoutMs,
      });
    },
    enabled: queryActive && enabled && !!category && items.length > 0 && connectionActive,
    placeholderData: (previousData) => previousData ?? placeholderData,
    staleTime: options.staleTime ?? 30000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64AllConfig(options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const appVisible = useAppVisibilityState();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && (screenActive || !appVisible);
  const { data: categories } = useC64Categories(options);

  return useQuery({
    queryKey: ["c64-all-config"],
    queryFn: async () => {
      const api = getC64API();
      const cats = await api.getCategories({ __c64uIntent: intent, timeoutMs: options.timeoutMs });
      const configs: Record<string, ConfigResponse> = {};

      for (const cat of cats.categories) {
        try {
          configs[cat] = await api.getCategory(cat, { __c64uIntent: intent, timeoutMs: options.timeoutMs });
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
    enabled: queryActive && !!categories && connectionActive,
    staleTime: 30000,
    refetchOnMount: options.refetchOnMount,
    placeholderData: (previousData) => previousData,
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
      skipInvalidation,
    }: {
      category: string;
      updates: Record<string, string | number>;
      skipInvalidation?: boolean;
    }) => {
      const api = getC64API();
      return api.updateConfigBatch({ [category]: updates });
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
  const routingEpoch = useConnectionRoutingEpoch();
  const intent = options.intent ?? "background";
  const screenActive = useScreenActivity();
  const appVisible = useAppVisibilityState();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && (screenActive || !appVisible);
  return useQuery({
    // routingEpoch is appended (not prepended) so prefix-based invalidation —
    // ["c64-config-item"] and ["c64-config-item", category] — still matches, while a
    // connection handoff re-resolves the value instead of reviving the cancelled read
    // (matches useC64Categories/useC64Category/useC64ConfigItems).
    queryKey: ["c64-config-item", category, item, routingEpoch],
    queryFn: async () => {
      const api = getC64API();
      if (!category || !item) {
        return null;
      }
      return api.getConfigItem(category, item, { __c64uIntent: intent, timeoutMs: options.timeoutMs });
    },
    enabled: queryActive && enabled && !!category && !!item && connectionActive,
    staleTime: 30000,
    refetchOnMount: options.refetchOnMount,
  });
}

export function useC64Drives(options: C64QueryOptions = {}) {
  const intent = options.intent ?? "background";
  const diagnosticsSuppressionActive = useDiagnosticsSuppressionActive();
  const screenActive = useScreenActivity();
  const pollingPaused = usePollingPauseState();
  const queryClient = useQueryClient();
  const connectionActive = useConnectionActive();
  const queryActive = (options.active ?? true) && screenActive && connectionActive;

  useEffect(() => {
    if (!pollingPaused) return;
    void queryClient.cancelQueries({ queryKey: ["c64-drives"], type: "active" });
  }, [pollingPaused, queryClient]);

  return useQuery({
    queryKey: ["c64-drives"],
    queryFn: async () => {
      const api = getC64API();
      return api.getDrives({ __c64uIntent: intent, timeoutMs: options.timeoutMs });
    },
    enabled: queryActive,
    staleTime: options.staleTime ?? 10000,
    refetchOnMount: options.refetchOnMount,
    refetchInterval:
      !queryActive || diagnosticsSuppressionActive ? false : () => (pollingPaused ? false : getDrivesPollIntervalMs()),
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
