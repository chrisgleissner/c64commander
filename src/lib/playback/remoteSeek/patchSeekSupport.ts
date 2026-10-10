/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

const STORAGE_KEY = "c64u_remote_seek_patch_unsafe_v1";

/** Firmware whose SID player a seek through its code once left damaged, by device and firmware version. */
type UnsafeStore = Record<string, { atMs: number; health: string }>;

/** A new firmware brings a new player, which is tried afresh. */
export const patchSeekFirmwareKey = (deviceInfo: { unique_id?: string | null; firmware_version?: string | null }) =>
  `${String(deviceInfo.unique_id ?? "").toLowerCase()}|${deviceInfo.firmware_version ?? ""}`;

const readStore = (): UnsafeStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UnsafeStore) : {};
  } catch (error) {
    addErrorLog("Remote seek could not read which firmware is unsafe to patch", { error: String(error) });
    return {};
  }
};

export const isPatchSeekUnsafe = (firmwareKey: string): boolean => firmwareKey in readStore();

/** Record that this firmware's player is unsafe to patch. True the first time, when the user is told. */
export const markPatchSeekUnsafe = (firmwareKey: string, health: string): boolean => {
  const store = readStore();
  if (firmwareKey in store) return false;
  store[firmwareKey] = { atMs: Date.now(), health };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    addErrorLog("Remote seek could not record which firmware is unsafe to patch", { error: String(error), health });
  }
  return true;
};
