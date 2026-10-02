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
import { subscribeDeviceWrites } from "@/lib/deviceInteraction/deviceWriteEvents";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import { addLog } from "@/lib/logging";

export const HOME_CONFIG_REFRESH_INTERVAL_MS = 10_000;
export const HOME_CONFIG_REFRESH_RETRY_MS = 1_000;
export const HOME_CONFIG_REFRESH_TIMEOUT_MS = 8_000;
export const HOME_CONFIG_REFRESH_ACTION_SETTLE_MS = 750;
const HOME_CONFIG_REFRESH_MIN_GAP_MS = 2_000;
const HOME_CONFIG_QUERY_PREFIX = "c64-config-items";

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

const refetchHomeConfig = async (queryClient: QueryClient) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), HOME_CONFIG_REFRESH_TIMEOUT_MS);
  });
  try {
    // cancelRefetch: false joins a read already on the wire instead of aborting and re-sending it.
    const outcome = await Promise.race([
      queryClient.refetchQueries({ queryKey: [HOME_CONFIG_QUERY_PREFIX], type: "active" }, { cancelRefetch: false }),
      timeout,
    ]);
    if (outcome === "timeout") {
      addLog("warn", "Home config refresh timed out; releasing the single-flight slot", {
        timeoutMs: HOME_CONFIG_REFRESH_TIMEOUT_MS,
      });
    }
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
  const writePendingRef = useRef(false);
  writePendingRef.current = Object.values(configWritePending).some(Boolean);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let trailing = false;
    let lastStartedAtMs = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    let actionId: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryId !== null) clearTimeout(retryId);
      retryId = null;
    };

    const run = async (reason: RefreshReason) => {
      inFlight = true;
      lastStartedAtMs = Date.now();
      try {
        await refetchHomeConfig(queryClient);
      } catch (error) {
        addLog("warn", "Home config refresh failed", {
          reason,
          error: (error as Error).message,
          stack: (error as Error).stack,
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
      if (getHomeConfigRefreshBlocker(writePendingRef.current) !== null) {
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
    // Config writes are re-read by the code that made them; any other action (reset, reboot,
    // menu, Telnet) can change values the device shows, so it gets a full re-read once it settles.
    const unsubscribeWrites = subscribeDeviceWrites((resourcePath) => {
      if (resourcePath.startsWith("/v1/configs")) return;
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
