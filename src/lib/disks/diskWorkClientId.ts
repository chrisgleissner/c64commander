/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

export const DISK_WORK_CLIENT_ID_STORAGE_KEY = "c64u_disk_work_client_id:v1";

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}$/;

let sessionClientId: string | null = null;

const createClientId = () => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * This install's name for its disk work files. Every phone that drives the same Ultimate writes its work files to
 * that Ultimate's storage, so the names must not collide: a shared name let one phone's mount replace another's
 * bytes, and the other phone's eject then saved them over its own local disk.
 */
export const getDiskWorkClientId = (): string => {
  try {
    const stored = localStorage.getItem(DISK_WORK_CLIENT_ID_STORAGE_KEY);
    if (stored && CLIENT_ID_PATTERN.test(stored)) return stored;
    const created = createClientId();
    localStorage.setItem(DISK_WORK_CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch (error) {
    sessionClientId ??= createClientId();
    addErrorLog("Disk work client id could not be stored; using one for this session only", {
      clientId: sessionClientId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return sessionClientId;
  }
};

export const resetDiskWorkClientIdForTests = () => {
  sessionClientId = null;
};
