/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionState } from "@/hooks/useConnectionState";
import {
  discoverConnection,
  getConnectionSnapshot,
  initializeConnectionManager,
} from "@/lib/connection/connectionManager";
import { buildBaseUrlFromDeviceHost, resolveDeviceHostFromStorage } from "@/lib/c64api";
import { APP_SETTINGS_KEYS, loadBackgroundRediscoveryIntervalMs } from "@/lib/config/appSettings";
import { getPassword as loadStoredPassword, hasStoredPasswordFlag } from "@/lib/secureStorage";
import { invalidateForConnectionStateTransition } from "@/lib/query/c64QueryInvalidation";
import { getBackgroundRediscoveryDelayMs, getNextBackgroundFailureCount } from "@/lib/query/c64PollingGovernance";

const allowBackgroundRediscovery = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES !== "1") return true;
  if (typeof window === "undefined") return false;
  return (window as Window & { __c64uAllowBackgroundRediscovery?: boolean }).__c64uAllowBackgroundRediscovery === true;
};

export function ConnectionController() {
  const queryClient = useQueryClient();
  const { state, lastProbeAtMs } = useConnectionState();
  const backgroundTimerRef = useRef<number | null>(null);
  const backgroundScheduleTokenRef = useRef(0);
  const backgroundFailureCountRef = useRef(0);
  const lastSettingsRef = useRef<{
    baseUrl: string;
    password: string;
    deviceHost: string;
  } | null>(null);
  const previousStateRef = useRef(state);
  const [backgroundScheduleVersion, setBackgroundScheduleVersion] = useState(0);

  useEffect(() => {
    void initializeConnectionManager().then(() => {
      void discoverConnection("startup");
    });
  }, []);

  useEffect(() => {
    invalidateForConnectionStateTransition(queryClient, previousStateRef.current, state);
    previousStateRef.current = state;
  }, [queryClient, state]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) return;
      const snapshot = getConnectionSnapshot();
      if (snapshot.state === "DISCOVERING" || state === "DISCOVERING") return;
      const effectiveLastProbeAtMs = Math.max(lastProbeAtMs ?? 0, snapshot.lastProbeAtMs ?? 0) || null;
      const minResumeProbeIntervalMs = Math.max(1500, loadBackgroundRediscoveryIntervalMs());
      if (effectiveLastProbeAtMs !== null && Date.now() - effectiveLastProbeAtMs < minResumeProbeIntervalMs) {
        return;
      }
      void discoverConnection("resume");
    };

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [lastProbeAtMs, state]);

  useEffect(() => {
    const scheduleToken = backgroundScheduleTokenRef.current + 1;
    backgroundScheduleTokenRef.current = scheduleToken;

    const clearTimer = () => {
      if (backgroundTimerRef.current) {
        window.clearTimeout(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
    };

    if (state !== "DEMO_ACTIVE" && state !== "OFFLINE_NO_DEMO") {
      clearTimer();
      return;
    }

    if (!allowBackgroundRediscovery()) {
      clearTimer();
      return;
    }

    const intervalMs = loadBackgroundRediscoveryIntervalMs();
    const scheduleNextProbe = (failureCount: number) => {
      const delayMs = getBackgroundRediscoveryDelayMs(intervalMs, failureCount);
      clearTimer();
      backgroundTimerRef.current = window.setTimeout(() => {
        if (backgroundScheduleTokenRef.current !== scheduleToken) {
          clearTimer();
          return;
        }
        if (!allowBackgroundRediscovery()) {
          clearTimer();
          return;
        }
        void discoverConnection("background").finally(() => {
          const snapshot = getConnectionSnapshot();
          const nextFailureCount = getNextBackgroundFailureCount(backgroundFailureCountRef.current, {
            lastProbeSucceededAtMs: snapshot.lastProbeSucceededAtMs,
            lastProbeFailedAtMs: snapshot.lastProbeFailedAtMs,
          });
          backgroundFailureCountRef.current = nextFailureCount;
          if (backgroundScheduleTokenRef.current !== scheduleToken) {
            clearTimer();
            return;
          }
          if (snapshot.state === "DEMO_ACTIVE" || snapshot.state === "OFFLINE_NO_DEMO") {
            scheduleNextProbe(nextFailureCount);
          }
        });
      }, delayMs);
    };

    backgroundFailureCountRef.current = 0;
    clearTimer();
    scheduleNextProbe(backgroundFailureCountRef.current);

    return clearTimer;
  }, [backgroundScheduleVersion, state]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { baseUrl?: string; password?: string; deviceHost?: string }
        | undefined;
      if (!detail) return;
      const next = {
        baseUrl: typeof detail.baseUrl === "string" ? detail.baseUrl : "",
        password: typeof detail.password === "string" ? detail.password : "",
        deviceHost: typeof detail.deviceHost === "string" ? detail.deviceHost : "",
      };
      const prev = lastSettingsRef.current;
      lastSettingsRef.current = next;
      if (!prev) return;
      const baseUrlChanged = prev.baseUrl !== next.baseUrl;
      const passwordChanged = prev.password !== next.password;
      const hostChanged = prev.deviceHost !== next.deviceHost;
      if (!baseUrlChanged && !passwordChanged && !hostChanged) return;
      void discoverConnection("settings");
    };

    // Prime the comparison with current persisted settings.
    const storedDeviceHost = resolveDeviceHostFromStorage();
    lastSettingsRef.current = {
      baseUrl: buildBaseUrlFromDeviceHost(storedDeviceHost),
      password: "",
      deviceHost: storedDeviceHost,
    };
    if (hasStoredPasswordFlag()) {
      void loadStoredPassword().then((value) => {
        if (!lastSettingsRef.current) return;
        lastSettingsRef.current = {
          ...lastSettingsRef.current,
          password: value || "",
        };
      });
    }

    window.addEventListener("c64u-connection-change", handler as EventListener);
    return () => window.removeEventListener("c64u-connection-change", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key !== APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY) return;
      setBackgroundScheduleVersion((previous) => previous + 1);
    };

    window.addEventListener("c64u-app-settings-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
  }, []);

  return null;
}
