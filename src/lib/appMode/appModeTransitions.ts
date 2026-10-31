/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadStartupMode, saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { discardDeviceDiscovery } from "@/lib/deviceDiscovery/discoveryManager";
import { clearHistoryBaseline, markHistoryBaseline } from "@/lib/navigation/navigateBack";
import { releaseDeviceForSidPlayer } from "@/lib/appMode/deviceRelease";
import {
  discoverConnection,
  pinDemoModeByUserChoice,
  transitionToOfflineNoDemo,
} from "@/lib/connection/connectionManager";

export const enterSidPlayer = async (): Promise<void> => {
  await releaseDeviceForSidPlayer();
  saveStartupModeByUser("sid-player");
  markHistoryBaseline();
  discardDeviceDiscovery();
  await transitionToOfflineNoDemo("settings");
};

export const switchToFullApp = async (): Promise<void> => {
  saveStartupModeByUser("default");
  clearHistoryBaseline();
  await discoverConnection("settings");
};

export const switchToDemoMode = async (): Promise<void> => {
  saveStartupModeByUser("default");
  clearHistoryBaseline();
  await pinDemoModeByUserChoice();
};

export const startForStartupMode = async (): Promise<void> => {
  if (loadStartupMode() === "demo") {
    await pinDemoModeByUserChoice();
    return;
  }
  await discoverConnection("startup");
};
