/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API } from "@/lib/c64api";
import { getConnectedDeviceIdentity } from "@/lib/connection/connectedDeviceIdentity";
import { addLog } from "@/lib/logging";
import { machineIdentityKey } from "@/lib/savedDevices/machineIdentity";
import type { RemoteSeekApi, RemoteSidSeekController } from "./remoteSidSeekController";

/** The REST API as remote seeking uses it, bound to the identity of the device it talks to now. */
export const createRemoteSeekApi = (): RemoteSeekApi => {
  const api = getC64API();
  return {
    currentDeviceKey: () => machineIdentityKey(getConnectedDeviceIdentity()),
    getConfigItem: (category, item, options) => api.getConfigItem(category, item, options),
    setConfigValue: (category, item, value, options) => api.setConfigValue(category, item, value, options),
    sendMachineInputBatch: (batch) => api.sendMachineInputBatch(batch),
    getMachineInputState: () => api.getMachineInputState({ __c64uIntent: "user" }),
    readMemory: (address, length, options) => api.readMemory(address, length, options),
  };
};

let active: RemoteSidSeekController | null = null;

export const setActiveRemoteSidSeek = (controller: RemoteSidSeekController | null) => {
  active = controller;
};

/**
 * Stop any remote seek and give the device back before the caller changes what the C64 does.
 * Stop, pause and starting another tune call this first, so a held key or a raised CPU Speed can
 * never carry over into what comes next.
 */
export const cancelRemoteSidSeek = async (reason: string): Promise<void> => {
  const controller = active;
  if (!controller?.isBusy) return;
  addLog("debug", "Remote seek cancelled", { reason });
  await controller.cancel(reason);
};

/** Whether a remote seek holds or is about to hold the device; callers skip the await when not. */
export const isRemoteSidSeekBusy = (): boolean => active?.isBusy ?? false;
