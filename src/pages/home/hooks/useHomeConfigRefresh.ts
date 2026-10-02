/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useScreenActivity } from "@/hooks/useScreenActivity";
import { areBackgroundReadsSuspended } from "@/lib/deviceInteraction/deviceActivityGate";
import { getDeviceStateSnapshot } from "@/lib/deviceInteraction/deviceStateStore";
import { subscribeDeviceWrites, TELNET_DEVICE_ACTION } from "@/lib/deviceInteraction/deviceWriteEvents";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import { addLog } from "@/lib/logging";
import { readHomeConfig } from "./homeConfigRead";

export const HOME_CONFIG_REFRESH_INTERVAL_MS = 10_000;
export const HOME_CONFIG_REFRESH_RETRY_MS = 1_000;
export const HOME_CONFIG_REFRESH_TIMEOUT_MS = 8_000;
// The wildcard read holds a device-request slot; on the one-slot Conservative profile a longer read
// would hold back a Stop or a stream toggle, so it gets the background budget, not the refresh's.
export const HOME_CONFIG_READ_TIMEOUT_MS = 3_000;
export const HOME_CONFIG_REFRESH_ACTION_SETTLE_MS = 750;
export const HOME_CONFIG_REFRESH_MAX_BACKOFF_MS = 60_000;
const HOME_CONFIG_REFRESH_MIN_GAP_MS = 2_000;

type RefreshReason = "interval" | "visible" | "focus" | "action" | "retry" | "trailing";

export type HomeConfigRefreshBlocker =
  | "hidden"
  | "machine-transition-or-write-burst"
  | "polling-paused"
  | "device-busy"
  | "circuit-open"
  | "config-write-pending"
  | "editing-text";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const isEditingText = () => {
  const element = typeof document === "undefined" ? null : document.activeElement;
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
};

const isDocumentHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Why a Home config refresh may not start now, or null when it may. */
export const getHomeConfigRefreshBlocker = (configWritePending: boolean): HomeConfigRefreshBlocker | null => {
  if (isDocumentHidden()) return "hidden";
  if (areBackgroundReadsSuspended()) return "machine-transition-or-write-burst";
  if (pollingPauseRegistry.isPollingPaused()) return "polling-paused";
  const deviceState = getDeviceStateSnapshot();
  if (deviceState.busyCount > 0) return "device-busy";
  if (deviceState.circuitOpenUntilMs !== null && deviceState.circuitOpenUntilMs > Date.now()) return "circuit-open";
  if (configWritePending) return "config-write-pending";
  if (isEditingText()) return "editing-text";
  return null;
};

// Runners apply a program's .cfg, drive commands change drive settings, and reset, reboot and the
// menu button can change values the device shows. Input, streams, memory access and pause cannot.
const HOME_CONFIG_AFFECTING_ACTIONS = [
  /^\/v1\/machine:(reset|reboot|menu_button)$/,
  /^\/v1\/drives\//,
  /^\/v1\/runners:(run_prg|load_prg|run_crt)$/,
];

/** True when a completed device action can change config values Home shows. */
export const isHomeConfigAffectingAction = (resourcePath: string) =>
  resourcePath === TELNET_DEVICE_ACTION || HOME_CONFIG_AFFECTING_ACTIONS.some((pattern) => pattern.test(resourcePath));

const isUserInteracting = () =>
  areBackgroundReadsSuspended() || pollingPauseRegistry.isPollingPaused() || isEditingText();

/** Resolves false when the refresh outlived HOME_CONFIG_REFRESH_TIMEOUT_MS. */
const readHomeConfigWithTimeout = async (queryClient: QueryClient, pending: () => Record<string, boolean>) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), HOME_CONFIG_REFRESH_TIMEOUT_MS);
  });
  try {
    const guards = {
      isInteracting: isUserInteracting,
      isWritePending: (category: string, item: string) => pending()[`${category}::${item}`] === true,
    };
    const outcome = await Promise.race([readHomeConfig(queryClient, guards, HOME_CONFIG_READ_TIMEOUT_MS), timeout]);
    return outcome !== "timeout";
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};

/**
 * Keeps Home showing the device's current config while Home is the visible page: re-reads every
 * active Home config query on becoming visible or focused, after a device action, and every
 * HOME_CONFIG_REFRESH_INTERVAL_MS. One refresh at a time, and never while the user is interacting.
 */
export function useHomeConfigRefresh({
  connected,
  configWritePending,
}: {
  connected: boolean;
  configWritePending: Record<string, boolean>;
}) {
  const queryClient = useQueryClient();
  const screenActive = useScreenActivity();
  const enabled = connected && screenActive;
  const writePendingRef = useRef(configWritePending);
  writePendingRef.current = configWritePending;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let trailing = false;
    let lastStartedAtMs = 0;
    let consecutiveFailures = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    let actionId: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryId !== null) clearTimeout(retryId);
      retryId = null;
    };

    const backoffIntervalMs = () =>
      Math.min(HOME_CONFIG_REFRESH_INTERVAL_MS * 2 ** consecutiveFailures, HOME_CONFIG_REFRESH_MAX_BACKOFF_MS);
    const recordFailure = () => {
      consecutiveFailures += 1;
      return { consecutiveFailures, nextIntervalMs: backoffIntervalMs() };
    };

    const run = async (reason: RefreshReason) => {
      inFlight = true;
      lastStartedAtMs = Date.now();
      try {
        const completed = await readHomeConfigWithTimeout(queryClient, () => writePendingRef.current);
        if (!completed) {
          addLog("warn", "Home config refresh timed out; releasing the single-flight slot", {
            reason,
            timeoutMs: HOME_CONFIG_REFRESH_TIMEOUT_MS,
            ...recordFailure(),
          });
        } else if (consecutiveFailures > 0) {
          addLog("info", "Home config refresh recovered", { reason, afterFailures: consecutiveFailures });
          consecutiveFailures = 0;
        }
      } catch (error) {
        addLog("warn", "Home config refresh failed", {
          reason,
          error: (error as Error).message,
          stack: (error as Error).stack,
          ...recordFailure(),
        });
      } finally {
        inFlight = false;
        if (trailing && !disposed) {
          trailing = false;
          requestRefresh("trailing");
        }
      }
    };

    const requestRefresh = (reason: RefreshReason) => {
      if (disposed || isDocumentHidden()) return;
      if (inFlight) {
        if (reason !== "interval") trailing = true;
        return;
      }
      if (
        (reason === "visible" || reason === "focus") &&
        Date.now() - lastStartedAtMs < HOME_CONFIG_REFRESH_MIN_GAP_MS
      ) {
        return;
      }
      if (reason === "interval" && consecutiveFailures > 0 && Date.now() - lastStartedAtMs < backoffIntervalMs()) {
        return;
      }
      if (getHomeConfigRefreshBlocker(Object.values(writePendingRef.current).some(Boolean)) !== null) {
        if (retryId === null) {
          retryId = setTimeout(() => {
            retryId = null;
            requestRefresh("retry");
          }, HOME_CONFIG_REFRESH_RETRY_MS);
        }
        return;
      }
      clearRetry();
      void run(reason);
    };

    const startInterval = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => requestRefresh("interval"), HOME_CONFIG_REFRESH_INTERVAL_MS);
    };
    const stopTimers = () => {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
      clearRetry();
      if (actionId !== null) clearTimeout(actionId);
      actionId = null;
    };

    const handleVisibilityChange = () => {
      if (isDocumentHidden()) {
        stopTimers();
        return;
      }
      startInterval();
      requestRefresh("visible");
    };
    const handleFocus = () => requestRefresh("focus");
    // Config writes are re-read by the code that made them.
    const unsubscribeWrites = subscribeDeviceWrites((resourcePath) => {
      if (!isHomeConfigAffectingAction(resourcePath)) return;
      if (actionId !== null) clearTimeout(actionId);
      actionId = setTimeout(() => {
        actionId = null;
        requestRefresh("action");
      }, HOME_CONFIG_REFRESH_ACTION_SETTLE_MS);
    });

    if (!isDocumentHidden()) startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      disposed = true;
      stopTimers();
      unsubscribeWrites();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled, queryClient]);
}
