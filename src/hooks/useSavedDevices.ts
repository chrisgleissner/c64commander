/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import { getSavedDevicesSnapshot, subscribeSavedDevices } from "@/lib/savedDevices/store";

export function useSavedDevices() {
  return useSyncExternalStore(subscribeSavedDevices, getSavedDevicesSnapshot, getSavedDevicesSnapshot);
}
