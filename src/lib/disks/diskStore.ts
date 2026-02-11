/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DiskEntry } from './diskTypes';

const STORE_PREFIX = 'c64u_disk_library:';

export type DiskLibraryState = {
  disks: DiskEntry[];
};

const getKey = (uniqueId: string) => `${STORE_PREFIX}${uniqueId}`;

export const loadDiskLibrary = (uniqueId: string): DiskLibraryState => {
  const raw = localStorage.getItem(getKey(uniqueId));
  if (!raw) return { disks: [] };
  try {
    const parsed = JSON.parse(raw) as DiskLibraryState;
    return {
      disks: Array.isArray(parsed.disks) ? parsed.disks : [],
    };
  } catch (error) {
    console.warn('Failed to load disk library', { uniqueId, error });
    return { disks: [] };
  }
};

export const saveDiskLibrary = (uniqueId: string, state: DiskLibraryState) => {
  localStorage.setItem(getKey(uniqueId), JSON.stringify(state));
};
