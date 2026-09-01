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

/**
 * Without this grant Android drops the foreground service's notification (verified on API 36), and
 * that notification is the only sign playback is still running. Android reports "denied" once the
 * user has refused, so checking first is what keeps this to a single prompt.
 */
export const ensureNotificationPermission = async (): Promise<PermissionState> => {
  if (!isNativePlatform() || getPlatform() !== "android") return "granted";
  try {
    const current = await BackgroundExecution.checkPermissions();
    if (current.notifications !== "prompt" && current.notifications !== "prompt-with-rationale") {
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
