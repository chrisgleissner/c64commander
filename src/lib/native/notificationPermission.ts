/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import {
  BackgroundExecution,
  NOTIFICATIONS_PERMISSION_ALIAS,
  type PermissionState,
} from "@/lib/native/backgroundExecution";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import type { ConnectionState } from "@/lib/connection/connectionManager";

/**
 * Without this grant Android drops the foreground service's notification (verified on API 36). Android
 * reports `prompt-with-rationale` after one refusal and `denied` after two; both are taken as the
 * answer, because refusing costs only that notification. Below API 33 AndroidX reports the
 * permission from whether notifications are enabled, so no prompt can appear there.
 */
export const ensureNotificationPermission = async (): Promise<PermissionState> => {
  if (!isNativePlatform() || getPlatform() !== "android") return "granted";
  try {
    const current = await BackgroundExecution.checkPermissions();
    if (current.notifications !== "prompt") {
      return current.notifications;
    }
    const requested = await BackgroundExecution.requestPermissions({
      permissions: [NOTIFICATIONS_PERMISSION_ALIAS],
    });
    return requested.notifications;
  } catch (error) {
    addLog("warn", "Notification permission check failed", {
      source: "notification-permission",
      error: error instanceof Error ? error.message : String(error),
    });
    return "denied";
  }
};

let plannedRequest: Promise<PermissionState> | null = null;

/**
 * Asks at most once per app session. The platform's own state stops a later session from asking
 * again after a refusal; this stops one session from asking twice while the first answer is pending.
 */
export const requestNotificationPermissionOnce = (): Promise<PermissionState> => {
  plannedRequest ??= ensureNotificationPermission();
  return plannedRequest;
};

export interface NotificationPermissionMomentInput {
  connectionState: ConnectionState;
  interstitialActive: boolean;
  tourActive: boolean;
  tourOfferPending: boolean;
  playbackActive: boolean;
}

/**
 * The system prompt takes every key press until it is answered, so it is raised only when nothing
 * else is in progress: a device (or Demo Mode) is connected, no dialog, sheet or tour is open, and
 * nothing is playing. Starting playback never asks.
 */
export const isNotificationPermissionMoment = (input: NotificationPermissionMomentInput): boolean =>
  (input.connectionState === "REAL_CONNECTED" || input.connectionState === "DEMO_ACTIVE") &&
  !input.interstitialActive &&
  !input.tourActive &&
  !input.tourOfferPending &&
  !input.playbackActive;
