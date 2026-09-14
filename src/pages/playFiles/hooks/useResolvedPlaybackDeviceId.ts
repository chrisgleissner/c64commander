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

// The simulated device names itself MOCK-<hostname> (MockC64UState.kt); earlier builds stored that id.
const isSimulatedDeviceId = (id: string | null) => Boolean(id?.startsWith("MOCK-"));

/**
 * The id of the device playback belongs to, remembered across launches. Demo Mode's simulated
 * device is used while it is active but never remembered, so it cannot outlive Demo Mode.
 */
export function useResolvedPlaybackDeviceId(deviceInfoId: string | null, simulatedDevice = false) {
  const [lastKnownDeviceId, setLastKnownDeviceId] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(LAST_DEVICE_ID_KEY);
    if (!isSimulatedDeviceId(stored)) return stored;
    localStorage.removeItem(LAST_DEVICE_ID_KEY);
    return null;
  });

  useEffect(() => {
    if (!deviceInfoId || simulatedDevice || typeof localStorage === "undefined") return;
    setLastKnownDeviceId(deviceInfoId);
    try {
      localStorage.setItem(LAST_DEVICE_ID_KEY, deviceInfoId);
    } catch (error) {
      addErrorLog("Failed to persist last known device id", {
        error: (error as Error).message,
      });
    }
  }, [deviceInfoId, simulatedDevice]);

  return deviceInfoId || lastKnownDeviceId || "default";
}
