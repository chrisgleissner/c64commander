/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ScreenOrientation } from "@capacitor/screen-orientation";
import { loadScreenOrientationMode, type ScreenOrientationMode } from "@/lib/config/appSettings";
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

/**
 * Apply the persisted (or default) screen-orientation mode at app startup.
 *
 * The default is Portrait (`DEFAULT_SCREEN_ORIENTATION_MODE`). The Android
 * MainActivity declares no `android:screenOrientation`, so without this startup
 * lock the activity is sensor-driven and a fresh install rotates freely (i.e.
 * behaves like "auto" even though the stored setting is Portrait). Calling this
 * at launch locks a fresh install to Portrait and honours an explicit
 * Auto/Landscape choice once the user has changed it. Fire-and-forget — the
 * native lock is async and any failure is logged, never thrown.
 */
export const applyScreenOrientationFromSettings = (): void => {
  void applyScreenOrientationMode(loadScreenOrientationMode());
};
