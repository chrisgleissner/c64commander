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
import { getDeviceDiscoveryState, subscribeDeviceDiscovery } from "@/lib/deviceDiscovery/discoveryManager";

const allowBackgroundRediscovery = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES !== "1") return true;
  if (typeof window === "undefined") return false;
  return (window as Window & { __c64uAllowBackgroundRediscovery?: boolean }).__c64uAllowBackgroundRediscovery === true;
};

const isAppVisibleForRediscovery = () =>
  typeof document === "undefined" || (!document.hidden && document.visibilityState !== "hidden");

const hasAutomaticDiscoveryResultsAwaitingSelection = () => {
  const discovery = getDeviceDiscoveryState();
  return (
    discovery.phase === "complete" &&
    discovery.candidates.length > 0 &&
    // HARD19-028: once the user dismisses the picker ("Not now" / Open Settings)
    // the results are acknowledged and no longer suspend automatic reconnection.
    // Without this, one dismissal permanently disabled every background probe,
    // failure-streak escalation, and resume sweep for the session.
    !discovery.acknowledged &&
    (discovery.trigger === "startup" || discovery.trigger === "resume")
  );
};

/**
 * HARD16-002: a foreground return after a long background counts as a resume —
 * unlike a quick blur/focus flip (tab switch, notification shade), it may have
 * outlived the selected device's power state or crossed a Wi-Fi network. Only
 * then do we run the full saved-device sweep + discovery via the "resume"
 * trigger; shorter hides keep re-arming the selected-device background probe.
 */
const RESUME_REDISCOVERY_MIN_HIDDEN_MS = 30_000;

// HARD18-007: the plain background probe only ever re-checks the same stored
// host - if the device changed IP (e.g. DHCP re-assignment after the
// firmware-wedge power-cycle), it fails forever. After enough consecutive
// failures, escalate ONCE to the "resume" trigger's saved-device sweep + LAN
// scan (the same fallback HARD16-002 already gives a long-hidden-tab
// return), instead of looping the same doomed probe indefinitely.
const BACKGROUND_ESCALATE_AFTER_FAILURES = 3;

export function ConnectionController() {
  const queryClient = useQueryClient();
  const { state } = useConnectionState();
  const backgroundTimerRef = useRef<number | null>(null);
  const backgroundScheduleTokenRef = useRef(0);
  const backgroundFailureCountRef = useRef(0);
  const hasEscalatedBackgroundFailuresRef = useRef(false);
  const lastSettingsRef = useRef<{
    baseUrl: string;
    password: string;
    deviceHost: string;
  } | null>(null);
  const previousStateRef = useRef(state);
  const hiddenAtMsRef = useRef<number | null>(null);
  const [backgroundScheduleVersion, setBackgroundScheduleVersion] = useState(0);
  const wasAwaitingSelectionRef = useRef(hasAutomaticDiscoveryResultsAwaitingSelection());

  useEffect(() => {
    void initializeConnectionManager().then(() => {
      void discoverConnection("startup");
    });
  }, []);

  // HARD19-028: the background-scheduling effect below early-returns while
  // discovery results are awaiting selection, and only re-runs on
  // [backgroundScheduleVersion, state]. Dismissing the picker acknowledges the
  // results (flipping the gate) but changes neither dependency, so the probe
  // would never resume. Subscribe to the discovery store and, when the gate
  // transitions from blocking to open, bump the schedule version so the effect
  // re-evaluates and re-arms the background probe. Value-equality bail: only
  // bump on the true -> false edge, never on unrelated store emits.
  useEffect(() => {
    const unsubscribe = subscribeDeviceDiscovery(() => {
      const nowAwaiting = hasAutomaticDiscoveryResultsAwaitingSelection();
      const wasAwaiting = wasAwaitingSelectionRef.current;
      wasAwaitingSelectionRef.current = nowAwaiting;
      if (wasAwaiting && !nowAwaiting) {
        setBackgroundScheduleVersion((current) => current + 1);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    invalidateForConnectionStateTransition(queryClient, previousStateRef.current, state);
    previousStateRef.current = state;
  }, [queryClient, state]);

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

    if (!isAppVisibleForRediscovery()) {
      clearTimer();
      return;
    }

    if (hasAutomaticDiscoveryResultsAwaitingSelection()) {
      clearTimer();
      return;
    }

    const intervalMs = loadBackgroundRediscoveryIntervalMs();
    const scheduleNextProbe = (failureCount: number) => {
      if (!isAppVisibleForRediscovery()) {
        clearTimer();
        return;
      }
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
        if (!isAppVisibleForRediscovery()) {
          clearTimer();
          return;
        }
        if (hasAutomaticDiscoveryResultsAwaitingSelection()) {
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
          if (nextFailureCount === 0) hasEscalatedBackgroundFailuresRef.current = false;
          if (backgroundScheduleTokenRef.current !== scheduleToken) {
            clearTimer();
            return;
          }
          if (snapshot.state === "DEMO_ACTIVE" || snapshot.state === "OFFLINE_NO_DEMO") {
            // HARD18-007: escalate ONCE per failure streak, fire-and-forget -
            // the plain background schedule below keeps running regardless
            // (as a fallback, and to naturally pick up a "resume" success via
            // the state change this effect already depends on).
            if (
              snapshot.state === "OFFLINE_NO_DEMO" &&
              nextFailureCount >= BACKGROUND_ESCALATE_AFTER_FAILURES &&
              !hasEscalatedBackgroundFailuresRef.current &&
              allowBackgroundRediscovery() &&
              !hasAutomaticDiscoveryResultsAwaitingSelection()
            ) {
              hasEscalatedBackgroundFailuresRef.current = true;
              void discoverConnection("resume");
            }
            scheduleNextProbe(nextFailureCount);
          }
        });
      }, delayMs);
    };

    backgroundFailureCountRef.current = 0;
    hasEscalatedBackgroundFailuresRef.current = false;
    clearTimer();
    scheduleNextProbe(backgroundFailureCountRef.current);

    return clearTimer;
  }, [backgroundScheduleVersion, state]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isAppVisibleForRediscovery()) {
        hiddenAtMsRef.current = Date.now();
        backgroundScheduleTokenRef.current += 1;
        if (backgroundTimerRef.current) {
          window.clearTimeout(backgroundTimerRef.current);
          backgroundTimerRef.current = null;
        }
        return;
      }

      const hiddenAtMs = hiddenAtMsRef.current;
      hiddenAtMsRef.current = null;
      const hiddenDurationMs = hiddenAtMs === null ? 0 : Date.now() - hiddenAtMs;

      // HARD16-002: a long-hidden return to an offline app runs the full resume
      // recovery (saved-device sweep + discovery) instead of only re-arming the
      // selected-device background probe — which can never escalate to the
      // sweep and would leave the app offline forever while another saved
      // device is reachable. Guarded by the same "results awaiting selection"
      // check the background path uses, so it never churns a pending pick.
      if (
        hiddenDurationMs >= RESUME_REDISCOVERY_MIN_HIDDEN_MS &&
        state === "OFFLINE_NO_DEMO" &&
        allowBackgroundRediscovery() &&
        !hasAutomaticDiscoveryResultsAwaitingSelection()
      ) {
        void discoverConnection("resume");
        return;
      }

      if ((state === "DEMO_ACTIVE" || state === "OFFLINE_NO_DEMO") && allowBackgroundRediscovery()) {
        setBackgroundScheduleVersion((current) => current + 1);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [state]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { baseUrl?: string; password?: string; deviceHost?: string } | undefined;
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
      if (detail?.key === APP_SETTINGS_KEYS.DEMO_MODE_ENABLED_KEY) {
        void discoverConnection("settings");
        return;
      }
      if (detail?.key !== APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY) return;
      setBackgroundScheduleVersion((previous) => previous + 1);
    };

    window.addEventListener("c64u-app-settings-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
  }, []);

  return null;
}
