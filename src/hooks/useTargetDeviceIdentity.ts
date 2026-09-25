/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSavedDevices } from "@/hooks/useSavedDevices";
import { buildDeviceShortLabel } from "@/lib/savedDevices/shortLabel";
import { buildSavedDevicePrimaryLabel } from "@/lib/savedDevices/store";

export type TargetDeviceIdentity = {
  deviceId: string | null;
  /** More than one device is, or once was, saved: the user may not be talking to the one they think. */
  multiDevice: boolean;
  fullLabel: string | null;
  shortLabel: string | null;
};

/** The device the app's commands go to, named for the places that have to say which one it is. */
export const useTargetDeviceIdentity = (): TargetDeviceIdentity => {
  const savedDevices = useSavedDevices();
  const device =
    savedDevices.devices.find((entry) => entry.id === savedDevices.selectedDeviceId) ?? savedDevices.devices[0];
  if (!device) return { deviceId: null, multiDevice: false, fullLabel: null, shortLabel: null };
  const product = savedDevices.verifiedByDeviceId[device.id]?.product ?? null;
  const fullLabel = buildSavedDevicePrimaryLabel(device);
  return {
    deviceId: device.id,
    multiDevice: savedDevices.devices.length > 1 || savedDevices.hasEverHadMultipleDevices,
    fullLabel,
    shortLabel: buildDeviceShortLabel(fullLabel, product),
  };
};
