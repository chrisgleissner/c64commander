import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { addErrorLog } from '@/lib/logging';
import type { DiskEntry } from './diskTypes';
import { createDiskEntry, getLeafFolderName, isDiskImagePath, normalizeDiskPath } from './diskTypes';

export type FtpBrowserEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: string | null;
};

export const listFtpEntries = async (options: {
  host: string;
  password?: string;
  path: string;
}) => {
  const result = await listFtpDirectory({
    host: options.host,
    password: options.password || '',
    port: getStoredFtpPort(),
    path: options.path,
  });
  return result.entries as FtpBrowserEntry[];
};

const walkFtpFolder = async (
  options: { host: string; password?: string; groupName?: string | null },
  path: string,
  entries: DiskEntry[],
) => {
  const listing = await listFtpEntries({ host: options.host, password: options.password, path });
  for (const entry of listing) {
    if (entry.type === 'dir') {
      await walkFtpFolder(options, entry.path, entries);
    } else if (isDiskImagePath(entry.name)) {
      const normalized = normalizeDiskPath(entry.path);
      entries.push(
        createDiskEntry({
          path: normalized,
          location: 'ultimate',
          group: options.groupName ?? getLeafFolderName(normalized),
          sizeBytes: entry.size ?? null,
          modifiedAt: entry.modifiedAt ?? null,
          importOrder: entries.length,
        }),
      );
    }
  }
};

export const importFtpFolder = async (options: {
  host: string;
  password?: string;
  path: string;
}): Promise<DiskEntry[]> => {
  const disks: DiskEntry[] = [];
  try {
    const groupName = getLeafFolderName(options.path) || null;
    await walkFtpFolder({ ...options, groupName }, options.path, disks);
  } catch (error) {
    addErrorLog('FTP disk import failed', { path: options.path, error: (error as Error).message });
    throw error;
  }
  return disks;
};

export const importFtpFile = (path: string): DiskEntry => {
  const normalized = normalizeDiskPath(path);
  if (!isDiskImagePath(normalized)) {
    throw new Error('Found no disk file.');
  }
  return createDiskEntry({
    path: normalized,
    location: 'ultimate',
  });
};
