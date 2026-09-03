/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { LibraryInstall, LIBRARY_INSTALL_PLUGIN_NAME } from "@/lib/native/libraryInstall";
import { addLog } from "@/lib/logging";

const SOURCE = "hvsc-install-guard";

/**
 * Availability rather than `isNativePlatform()`: only Android implements the plugin, so iOS gets no
 * guard rather than a rejected call.
 */
const isGuardAvailable = (): boolean => Capacitor.isPluginAvailable(LIBRARY_INSTALL_PLUGIN_NAME);

/**
 * Holds a foreground service and a partial wake lock for the duration of an HVSC install
 * (HARD27-028). A baseline install runs near half an hour on a Pixel 4 with the phone put down, so
 * without the service the OS may doze the CPU, restrict the download, or reclaim the process — and
 * the install then restarts from the first byte.
 */
export const beginHvscInstallGuard = async (): Promise<void> => {
  if (!isGuardAvailable()) return;
  try {
    await LibraryInstall.start();
    addLog("debug", "HVSC install guard started", { source: SOURCE });
  } catch (error) {
    // A refused foreground service must not fail the install it was only protecting.
    addLog("warn", "HVSC install runs without a foreground service", {
      source: SOURCE,
      error: (error as Error).message,
    });
  }
};

export const endHvscInstallGuard = async (): Promise<void> => {
  if (!isGuardAvailable()) return;
  try {
    await LibraryInstall.stop();
    addLog("debug", "HVSC install guard stopped", { source: SOURCE });
  } catch (error) {
    addLog("warn", "HVSC install guard could not be released", {
      source: SOURCE,
      error: (error as Error).message,
    });
  }
};
