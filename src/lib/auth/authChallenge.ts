/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import { addLog } from "@/lib/logging";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

/**
 * App-wide "device requires its network password" challenge.
 *
 * Any device call that returns Forbidden/Unauthorized (HTTP 401/403) funnels
 * here through {@link notifyAuthRequired}. The store is **single-flight**: a
 * burst of Forbidden responses (e.g. a fan-out of config reads) raises at most
 * ONE popup. The recovery orchestration (store password, re-apply config,
 * re-probe) lives in `authChallengeController.ts` so this module stays free of
 * the REST/connection layers and cannot form an import cycle with `c64api`.
 */

export type AuthChallengeStatus = "prompting" | "submitting" | "error";

export type AuthChallenge = {
  /** Saved-device id of the affected device, when it can be resolved. */
  deviceId: string | null;
  /** Human label naming the affected device in the popup. */
  deviceLabel: string;
  /** Normalized host of the affected device, for attribution + dedupe. */
  host: string | null;
  status: AuthChallengeStatus;
  /** Error shown under the input (e.g. wrong password). */
  errorMessage: string | null;
  /** Number of rejected submit attempts so far. */
  attemptCount: number;
};

/** Optional operation to retry verbatim once the password is accepted. */
export type AuthChallengeRetry = () => Promise<unknown> | unknown;

export type NotifyAuthRequiredParams = {
  deviceId?: string | null;
  deviceLabel?: string | null;
  host?: string | null;
  retry?: AuthChallengeRetry | null;
};

let current: AuthChallenge | null = null;
let pendingRetry: AuthChallengeRetry | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const normalizeHost = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
};

const resolveIdentity = (
  params: NotifyAuthRequiredParams,
): { deviceId: string | null; deviceLabel: string; host: string | null } => {
  let deviceId = params.deviceId ?? null;
  let deviceLabel = params.deviceLabel?.trim() ?? "";
  let host = normalizeHost(params.host);

  try {
    const snapshot = getSavedDevicesSnapshot();
    // Attribute to the device the call actually hit (host match) and fall back
    // to the selected device so a bare notify still names the active device.
    const byHost = host ? snapshot.devices.find((device) => normalizeHost(device.host) === host) : undefined;
    const selected = snapshot.devices.find((device) => device.id === snapshot.selectedDeviceId);
    const device = byHost ?? selected;
    if (device) {
      deviceId = deviceId ?? device.id;
      if (!deviceLabel) deviceLabel = device.name?.trim() || device.host;
      host = host ?? normalizeHost(device.host);
    }
  } catch (error) {
    // Identity is best-effort; the popup still works with a generic label.
    addLog("debug", "Auth challenge identity resolution failed; using generic label", {
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
  }

  if (!deviceLabel) deviceLabel = host ?? "this device";
  return { deviceId, deviceLabel, host };
};

export const getAuthChallengeSnapshot = (): AuthChallenge | null => current;

export const subscribeAuthChallenge = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAuthChallenge = (): AuthChallenge | null =>
  useSyncExternalStore(subscribeAuthChallenge, getAuthChallengeSnapshot, getAuthChallengeSnapshot);

/** The retry closure for the open challenge, if one was supplied. */
export const getAuthChallengeRetry = (): AuthChallengeRetry | null => pendingRetry;

/**
 * Single-flight entry point. The first Forbidden response opens the popup;
 * while it is open (prompting / submitting / error) further notifications are
 * coalesced — they may attach a retry closure but never open a second dialog.
 */
export const notifyAuthRequired = (params: NotifyAuthRequiredParams = {}): void => {
  if (current) {
    if (!pendingRetry && params.retry) pendingRetry = params.retry;
    return;
  }
  pendingRetry = params.retry ?? null;
  current = { ...resolveIdentity(params), status: "prompting", errorMessage: null, attemptCount: 0 };
  emit();
};

export const setAuthChallengeStatus = (status: AuthChallengeStatus): void => {
  if (!current) return;
  current = { ...current, status };
  emit();
};

/** Mark the current attempt rejected and re-prompt (never resolves the challenge). */
export const setAuthChallengeError = (errorMessage: string | null): void => {
  if (!current) return;
  current = { ...current, status: "error", errorMessage, attemptCount: current.attemptCount + 1 };
  emit();
};

/**
 * Close the popup when a device call SUCCEEDS for the challenged host — proof the
 * stored password now works. This auto-clears a popup left open by a transient
 * re-probe failure (the C64U drops out intermittently) or a race where the
 * recovery probe failed but a concurrent call already succeeded. A success from a
 * *different* device never dismisses this device's prompt.
 */
export const notifyAuthSatisfied = (host: string | null | undefined): void => {
  if (!current) return;
  const reachable = normalizeHost(host);
  if (reachable !== null && current.host !== null && current.host !== reachable) return;
  current = null;
  pendingRetry = null;
  emit();
};

/** Close the popup after the password was accepted. */
export const resolveAuthChallenge = (): void => {
  if (!current && !pendingRetry) return;
  current = null;
  pendingRetry = null;
  emit();
};

/** Dismiss the popup without recovering (user cancelled). */
export const dismissAuthChallenge = (): void => {
  if (!current && !pendingRetry) return;
  current = null;
  pendingRetry = null;
  emit();
};

/** Test-only reset of the module singleton. */
export const resetAuthChallengeForTests = (): void => {
  current = null;
  pendingRetry = null;
  listeners.clear();
};
