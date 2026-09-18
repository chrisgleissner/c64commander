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
 * that notification is the only sign playback is still running.
 *
 * Asked at most once. Android does NOT report "denied" after a single refusal — it reports
 * `prompt-with-rationale`, which means "explain yourself before asking again". Treating that as
 * askable fired the same system dialog, with no explanation, at the start of the next tune: a user
 * who refused once on the Play page was asked again the next time they pressed play. Refusing costs
 * the notification and nothing else — the foreground service still starts and playback is
 * unaffected — so a refusal is taken as the answer.
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
