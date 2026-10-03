/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DiskEntry } from "./diskTypes";
import { repairLegacyDiskGroups } from "./diskGrouping";

const STORE_PREFIX = "c64u_disk_library:";
export const SHARED_DISK_LIBRARY_ID = "shared";
export const COVERAGE_PROBE_DISK_LIBRARY_ID = "coverage-probe";
/** Libraries that never belonged to one device, so they are not old per-device copies of the shared one. */
const NON_DEVICE_DISK_LIBRARY_IDS = new Set([SHARED_DISK_LIBRARY_ID, COVERAGE_PROBE_DISK_LIBRARY_ID]);

export type DiskLibraryState = {
  disks: DiskEntry[];
};

const getKey = (uniqueId: string) => `${STORE_PREFIX}${uniqueId}`;

const mergeLibraries = (states: DiskLibraryState[]) => {
  const seen = new Set<string>();
  const disks: DiskEntry[] = [];
  states.forEach((state) => {
    state.disks.forEach((disk) => {
      if (seen.has(disk.id)) return;
      seen.add(disk.id);
      disks.push(disk);
    });
  });
  return { disks } satisfies DiskLibraryState;
};

const parseState = (raw: string | null, uniqueId: string): DiskLibraryState => {
  if (!raw) return { disks: [] };
  try {
    const parsed = JSON.parse(raw) as DiskLibraryState;
    return {
      disks: Array.isArray(parsed.disks) ? repairLegacyDiskGroups(parsed.disks) : [],
    };
  } catch (error) {
    console.warn("Failed to load disk library", { uniqueId, error });
    return { disks: [] };
  }
};

export const loadDiskLibrary = (uniqueId: string): DiskLibraryState => {
  const raw = localStorage.getItem(getKey(uniqueId));
  const direct = parseState(raw, uniqueId);
  if (uniqueId !== SHARED_DISK_LIBRARY_ID || direct.disks.length > 0) {
    return direct;
  }
  const legacyKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(STORE_PREFIX) || NON_DEVICE_DISK_LIBRARY_IDS.has(key.slice(STORE_PREFIX.length))) {
      continue;
    }
    legacyKeys.push(key);
  }
  if (legacyKeys.length === 0) return direct;
  const merged = mergeLibraries(legacyKeys.map((key) => parseState(localStorage.getItem(key), key)));
  // Retire the per-device keys, or an emptied shared library would re-import them on every load.
  saveDiskLibrary(SHARED_DISK_LIBRARY_ID, merged);
  legacyKeys.forEach((key) => localStorage.removeItem(key));
  return merged;
};

export const saveDiskLibrary = (uniqueId: string, state: DiskLibraryState) => {
  localStorage.setItem(getKey(uniqueId), JSON.stringify(state));
};
