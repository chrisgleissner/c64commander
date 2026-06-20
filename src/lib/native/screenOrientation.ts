/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ScreenOrientation } from "@capacitor/screen-orientation";
import { type ScreenOrientationMode } from "@/lib/config/appSettings";
import { buildErrorLogDetails, addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";

export const applyScreenOrientationMode = async (mode: ScreenOrientationMode): Promise<void> => {
  if (!isNativePlatform()) return;

  try {
    if (mode === "auto") {
      await ScreenOrientation.unlock();
      return;
    }
    await ScreenOrientation.lock({ orientation: mode });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const details = buildErrorLogDetails(normalized, {
      operation: "SCREEN_ORIENTATION_APPLY",
      mode,
    });
    addLog("warn", "Failed to apply screen orientation mode", details);
    console.warn("Failed to apply screen orientation mode", details);
  }
};
