/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { isHandledUiError } from "@/lib/fileValidation";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

export type UiErrorReport = {
  operation: string;
  title: string;
  description: string;
  error?: unknown;
  context?: Record<string, unknown>;
  retry?: () => void;
  /** S3 (default) = destructive persistent toast; S2 = auto-dismiss notice ≤8 s (ERROR_POLICY §4) */
  severity?: "S2" | "S3";
  /** Host the error is attributed to — used for dedup key and stale-clear (ERROR_POLICY §5/§6) */
  deviceHost?: string;
  /** If true, log to diagnostics only; never toast (ERROR_POLICY §3 background rule) */
  background?: boolean;
};

// ─── Dedup state (ERROR_POLICY §5) ─────────────────────────────────────────

const DEDUP_WINDOW_MS = 30_000;
const S2_AUTO_DISMISS_MS = 8_000;

type DedupEntry = {
  dismiss: () => void;
  timestamp: number;
  count: number;
  deviceHost: string | undefined;
};

const dedupMap = new Map<string, DedupEntry>();

// Same normalization shape as connectionManager's reachability hosts so that
// recovery/switch clears match attribution recorded at report time.
const normalizeDeviceHost = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
};

// Errors raised without explicit attribution are attributed to the active
// device (matches deviceAttribution semantics); local-only errors can opt out
// by passing an explicit deviceHost.
const resolveActiveDeviceHost = (): string | undefined => {
  try {
    const snapshot = getSavedDevicesSnapshot();
    const selected = snapshot.devices.find((device) => device.id === snapshot.selectedDeviceId);
    return normalizeDeviceHost(selected?.host);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    addErrorLog("Failed to resolve active device host for UI error attribution", buildErrorLogDetails(err));
    return undefined;
  }
};

const deriveErrorClass = (description: string, error?: unknown): string => {
  const details = buildErrorDetails(error) as { message?: string } | undefined;
  const msg = `${description} ${details?.message ?? ""}`;
  return isTransientConnectivityFailure(msg) ? "connectivity" : "unknown";
};

const buildDedupKey = (operation: string, deviceHost: string | undefined, errorClass: string): string =>
  `${operation}|${deviceHost ?? ""}|${errorClass}`;

/** Reset dedup state between tests. Never call in production code. */
export const __clearDedupStateForTests = (): void => {
  dedupMap.clear();
};

/** Dismiss the live error toast for an operation that just succeeded (ERROR_POLICY §6). */
export const clearToastForSuccessfulOperation = (operation: string, deviceHost?: string): void => {
  const host = normalizeDeviceHost(deviceHost) ?? resolveActiveDeviceHost();
  const prefix = `${operation}|${host ?? ""}|`;
  dedupMap.forEach((entry, key) => {
    if (key.startsWith(prefix)) {
      entry.dismiss();
      dedupMap.delete(key);
    }
  });
};

/** Dismiss all error toasts attributed to a device being switched away from (ERROR_POLICY §6). */
export const clearToastsOnDeviceSwitch = (previousDeviceHost: string): void => {
  const host = normalizeDeviceHost(previousDeviceHost);
  if (!host) return;
  dedupMap.forEach((entry, key) => {
    if (entry.deviceHost === host) {
      entry.dismiss();
      dedupMap.delete(key);
    }
  });
};

/** Dismiss connectivity-class error toasts for a host that just recovered (ERROR_POLICY §6). */
export const clearConnectivityErrorToastsForHost = (recoveredHost: string): void => {
  const host = normalizeDeviceHost(recoveredHost);
  if (!host) return;
  dedupMap.forEach((entry, key) => {
    if (entry.deviceHost === host && key.endsWith("|connectivity")) {
      entry.dismiss();
      dedupMap.delete(key);
    }
  });
};

// ─── Error detail helpers ────────────────────────────────────────────────────

const buildErrorDetails = (error?: unknown) => {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }
  return { message: String(error) };
};

// Exported so c64api.ts and other modules can reuse the same detection logic
// instead of duplicating transient-failure pattern strings.
export const isTransientConnectivityFailure = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return /host unreachable|service unavailable|http 503|failed to fetch|net::err|request timed out|networkerror|dns/.test(
    normalized,
  );
};

const isRecoverableConnectivityError = (description: string, error?: unknown) => {
  const details = buildErrorDetails(error) as { message?: string } | undefined;
  const message = `${description} ${details?.message ?? ""}`;
  return isTransientConnectivityFailure(message);
};

export const reportUserError = ({
  operation,
  title,
  description,
  error,
  context,
  retry,
  severity = "S3",
  deviceHost,
  background,
}: UiErrorReport) => {
  if (isHandledUiError(error)) {
    return;
  }

  const attributedHost = normalizeDeviceHost(deviceHost) ?? resolveActiveDeviceHost();
  const errorClass = deriveErrorClass(description, error);
  const dedupKey = buildDedupKey(operation, attributedHost, errorClass);
  const existing = background ? undefined : dedupMap.get(dedupKey);
  const now = Date.now();
  const isDuplicate = Boolean(existing && now - existing.timestamp < DEDUP_WINDOW_MS);
  const occurrenceCount = isDuplicate && existing ? existing.count + 1 : 1;

  const logPayload = {
    operation,
    description,
    ...context,
    error: buildErrorDetails(error),
  };

  // Always log as error so the entry is captured even when the diagnostics
  // overlay is open (addLog at warn level is suppressed by the overlay).
  // The recoverableConnectivityIssue flag distinguishes transient failures
  // from persistent defects so callers can filter or present them differently.
  addErrorLog(`${operation}: ${title}`, {
    ...logPayload,
    ...(isRecoverableConnectivityError(description, error) ? { recoverableConnectivityIssue: true } : {}),
    ...(background ? { suppressedReason: "background-operation" } : {}),
    ...(isDuplicate ? { suppressedReason: "duplicate-toast-deduped", occurrenceCount } : {}),
  });

  // S0: background/system operations never surface as toasts (ERROR_POLICY §3).
  if (background) {
    return;
  }

  // §5 dedup — same operation+host+errorClass within 30 s → count it, skip new toast.
  if (isDuplicate && existing) {
    dedupMap.set(dedupKey, { ...existing, count: occurrenceCount, timestamp: now });
    return;
  }

  const variant = severity === "S2" ? undefined : "destructive";
  const toastResult = toast({
    title,
    description,
    variant,
    ...(retry
      ? {
          action: React.createElement(
            ToastAction,
            { altText: "Retry", onClick: retry },
            "Retry",
          ) as unknown as ToastActionElement,
        }
      : {}),
  });

  if (toastResult) {
    const dismiss = toastResult.dismiss ?? (() => {});
    dedupMap.set(dedupKey, { dismiss, timestamp: now, count: 1, deviceHost: attributedHost });
    if (severity === "S2") {
      setTimeout(dismiss, S2_AUTO_DISMISS_MS);
    }
  }
};
