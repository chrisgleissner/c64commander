/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { deviceInfoMachineIdentity, type MachineIdentity } from "@/lib/savedDevices/machineIdentity";

// The identity the really-connected device last reported, kept apart from the connection manager so
// a lightweight module can read it without loading the connection manager and its start-up work.
let connectedIdentity: MachineIdentity = deviceInfoMachineIdentity(null);

export const setConnectedDeviceIdentity = (info: Parameters<typeof deviceInfoMachineIdentity>[0]): void => {
  connectedIdentity = deviceInfoMachineIdentity(info);
};

export const getConnectedDeviceIdentity = (): MachineIdentity => connectedIdentity;
