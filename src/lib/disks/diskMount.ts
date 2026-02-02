import { addErrorLog, addLog } from '@/lib/logging';
import type { C64API } from '@/lib/c64api';
import { FolderPicker } from '@/lib/native/folderPicker';
import { getFileExtension } from '@/lib/playback/fileTypes';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import {
  getLocalSourceListingMode,
  getLocalSourceRuntimeFile,
  loadLocalSources,
  requireLocalSourceEntries,
  type LocalSourceRecord,
} from '@/lib/sourceNavigation/localSourcesStore';
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
  const normalizedPath = normalizeSourcePath(disk.path);
  const sources = loadLocalSources();

  const resolveFromSource = async (source: LocalSourceRecord): Promise<Blob | null> => {
    const runtime = getLocalSourceRuntimeFile(source.id, normalizedPath);
    if (runtime) return runtime;
    if (source.android?.treeUri) {
      const data = await FolderPicker.readFileFromTree({ treeUri: source.android.treeUri, path: normalizedPath });
      return new Blob([base64ToUint8(data.data)], { type: 'application/octet-stream' });
    }
    if (getLocalSourceListingMode(source) === 'entries') {
      try {
        const entries = requireLocalSourceEntries(source, 'diskMount.resolveLocalDiskBlob');
        const match = entries.find((entry) => normalizeSourcePath(entry.relativePath) === normalizedPath);
        if (match?.uri) {
          const data = await FolderPicker.readFile({ uri: match.uri });
          return new Blob([base64ToUint8(data.data)], { type: 'application/octet-stream' });
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  if (disk.sourceId) {
    const source = sources.find((entry) => entry.id === disk.sourceId);
    if (source) {
      const blob = await resolveFromSource(source);
      if (blob) return blob;
    }
  }

  for (const source of sources) {
    const blob = await resolveFromSource(source);
    if (blob) return blob;
  }

  throw new Error('Local disk access is missing. Re-add the folder or file to refresh permissions.');
};

export const mountDiskToDrive = async (
  api: C64API,
  drive: 'a' | 'b',
  disk: DiskEntry,
  runtimeFile?: File,
) => {
  try {
    const mountType = buildDiskMountType(disk.path);
    addLog('debug', 'Disk mount request', {
      drive,
      path: disk.path,
      location: disk.location,
      mountType,
      baseUrl: api.getBaseUrl(),
      deviceHost: api.getDeviceHost(),
    });
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
