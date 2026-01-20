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
  } catch {
    return { disks: [] };
  }
};

export const saveDiskLibrary = (uniqueId: string, state: DiskLibraryState) => {
  localStorage.setItem(getKey(uniqueId), JSON.stringify(state));
};
