import { addErrorLog } from '@/lib/logging';
import type { C64API } from '@/lib/c64api';
import { FolderPicker } from '@/lib/native/folderPicker';
import { getFileExtension } from '@/lib/playback/fileTypes';
import type { DiskEntry } from './diskTypes';

const base64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const buildDiskMountType = (path: string) => {
  const ext = getFileExtension(path);
  return ext || undefined;
};

export const resolveLocalDiskBlob = async (
  disk: DiskEntry,
  runtimeFile?: File,
): Promise<Blob> => {
  if (runtimeFile) return runtimeFile;
  if (disk.localUri) {
    const data = await FolderPicker.readFile({ uri: disk.localUri });
    return new Blob([base64ToUint8(data.data)], { type: 'application/octet-stream' });
  }
  if (disk.localTreeUri) {
    const data = await FolderPicker.readFileFromTree({ treeUri: disk.localTreeUri, path: disk.path });
    return new Blob([base64ToUint8(data.data)], { type: 'application/octet-stream' });
  }
  throw new Error('Local disk is missing a readable URI.');
};

export const mountDiskToDrive = async (
  api: C64API,
  drive: 'a' | 'b',
  disk: DiskEntry,
  runtimeFile?: File,
) => {
  try {
    const mountType = buildDiskMountType(disk.path);
    if (disk.location === 'ultimate') {
      await api.mountDrive(drive, disk.path, mountType, 'readwrite');
      return;
    }

    const blob = await resolveLocalDiskBlob(disk, runtimeFile);
    await api.mountDriveUpload(drive, blob, mountType, 'readwrite');
  } catch (error) {
    addErrorLog('Disk mount failed', {
      drive,
      path: disk.path,
      location: disk.location,
      baseUrl: api.getBaseUrl(),
      deviceHost: api.getDeviceHost(),
      endpoint: `/v1/drives/${drive}:mount`,
      error: (error as Error).message,
    });
    throw error;
  }
};
