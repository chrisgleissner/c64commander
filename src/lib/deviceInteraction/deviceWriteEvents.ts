/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/** A completed device action: a REST write's resource path, or `TELNET_DEVICE_ACTION` for a Telnet session. */
export type DeviceWriteListener = (resourcePath: string) => void;

export const TELNET_DEVICE_ACTION = "telnet";

const listeners = new Set<DeviceWriteListener>();

export const subscribeDeviceWrites = (listener: DeviceWriteListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const publishDeviceWrite = (resourcePath: string) => {
  listeners.forEach((listener) => {
    try {
      listener(resourcePath);
    } catch (error) {
      addLog("warn", "Device write listener threw", {
        resourcePath,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  });
};
