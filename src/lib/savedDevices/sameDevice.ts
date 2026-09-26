/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isSameMachine, savedEntryMachineIdentity, type MachineIdentity } from "./machineIdentity";
import {
  buildSavedDevicePrimaryLabel,
  getSavedDevicesSnapshot,
  type SavedDevice,
  type SavedDevicesSnapshot,
} from "./store";

/** Whether a saved entry is known to be the machine that reported `identity` (see `machineIdentityKey`). */
export const savedEntryIsMachine = (
  deviceId: string | null | undefined,
  identity: MachineIdentity,
  snapshot: SavedDevicesSnapshot = getSavedDevicesSnapshot(),
): boolean => {
  if (!deviceId) return false;
  return isSameMachine(savedEntryMachineIdentity(snapshot, deviceId), identity);
};

/**
 * Whether two saved entries are one machine: an Ultimate on Ethernet and Wi-Fi saved under both of
 * its addresses. Switching between them changes the address the app talks to, not the device.
 */
export const areSavedEntriesSameDevice = (
  leftId: string | null | undefined,
  rightId: string | null | undefined,
  snapshot: SavedDevicesSnapshot = getSavedDevicesSnapshot(),
): boolean => {
  if (!leftId || !rightId || leftId === rightId) return false;
  return savedEntryIsMachine(rightId, savedEntryMachineIdentity(snapshot, leftId), snapshot);
};

/** Another saved entry for the same machine as `deviceId`, if there is one. */
export const findSameDeviceEntry = (
  deviceId: string,
  snapshot: SavedDevicesSnapshot = getSavedDevicesSnapshot(),
): SavedDevice | null =>
  snapshot.devices.find((device) => areSavedEntriesSameDevice(deviceId, device.id, snapshot)) ?? null;

/** "Same device as …" for a saved entry that shares its machine with another entry, else null. */
export const describeSameDeviceEntry = (
  deviceId: string,
  snapshot: SavedDevicesSnapshot = getSavedDevicesSnapshot(),
): string | null => {
  const entry = findSameDeviceEntry(deviceId, snapshot);
  if (!entry) return null;
  return `Same device as ${buildSavedDevicePrimaryLabel(entry, snapshot.verifiedByDeviceId?.[entry.id] ?? null)}`;
};
