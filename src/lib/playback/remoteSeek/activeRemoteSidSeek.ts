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
    writeMemory: (address, data) => api.writeMemory(address, data, { __c64uIntent: "user" }),
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
  if (!controller || !isRemoteSidSeekBusy()) return;
  addLog("debug", "Remote seek cancelled", { reason });
  await controller.cancel(reason);
};

let gestureActive = false;

/** A hold or a drag is under way on the Play page, even before it has sent anything to the device. */
export const setRemoteSidSeekGesture = (on: boolean) => {
  gestureActive = on;
};

/**
 * Whether a remote seek is under way: a gesture, or an operation that holds or is about to hold the
 * device. Stop, pause and another tune cancel it first; auto-advance waits for it to land.
 */
export const isRemoteSidSeekBusy = (): boolean => gestureActive || (active?.isBusy ?? false);
