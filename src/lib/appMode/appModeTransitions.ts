/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadStartupMode } from "@/lib/appMode/appModeStore";
import { discoverConnection, pinDemoModeByUserChoice } from "@/lib/connection/connectionManager";

export const startForStartupMode = async (): Promise<void> => {
  if (loadStartupMode() === "demo") {
    await pinDemoModeByUserChoice();
    return;
  }
  await discoverConnection("startup");
};
