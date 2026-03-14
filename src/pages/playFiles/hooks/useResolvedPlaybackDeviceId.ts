/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { addErrorLog } from "@/lib/logging";
import { LAST_DEVICE_ID_KEY } from "@/pages/playFiles/playFilesUtils";

export function useResolvedPlaybackDeviceId(deviceInfoId: string | null) {
  const [lastKnownDeviceId, setLastKnownDeviceId] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LAST_DEVICE_ID_KEY);
  });

  useEffect(() => {
    if (!deviceInfoId || typeof localStorage === "undefined") return;
    setLastKnownDeviceId(deviceInfoId);
    try {
      localStorage.setItem(LAST_DEVICE_ID_KEY, deviceInfoId);
    } catch (error) {
      addErrorLog("Failed to persist last known device id", {
        error: (error as Error).message,
      });
    }
  }, [deviceInfoId]);

  return deviceInfoId || lastKnownDeviceId || "default";
}
