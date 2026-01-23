import { FolderPicker } from '@/lib/native/folderPicker';
import { normalizeDiskPath } from '@/lib/disks/diskTypes';
import type { PlayRequest, PlaySource, LocalPlayFile } from './playbackRouter';
import type { FileLibraryEntry } from './fileLibraryTypes';

export const normalizeFilePath = (path: string) => normalizeDiskPath(path);

export const buildFileLibraryId = (source: PlaySource, path: string, sourceId?: string | null) => {
  const normalized = normalizeFilePath(path);
  const sourceKey = source === 'local' ? sourceId || 'local' : 'ultimate';
  return `${sourceKey}:${normalized}`;
};

const base64ToArrayBuffer = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const buildLocalPlayFileFromUri = (name: string, path: string, uri: string): LocalPlayFile => ({
  name,
  webkitRelativePath: path,
  lastModified: Date.now(),
  arrayBuffer: async () => {
    const data = await FolderPicker.readFile({ uri });
    return base64ToArrayBuffer(data.data);
  },
});

export const buildLocalPlayFileFromTree = (name: string, path: string, treeUri: string): LocalPlayFile => ({
  name,
  webkitRelativePath: path,
  lastModified: Date.now(),
  arrayBuffer: async () => {
    const data = await FolderPicker.readFileFromTree({ treeUri, path });
    return base64ToArrayBuffer(data.data);
  },
});

export const resolvePlayRequestFromLibrary = (
  entry: FileLibraryEntry,
  runtimeFiles: Record<string, LocalPlayFile>,
): PlayRequest => {
  if (entry.source === 'ultimate') {
    return { source: 'ultimate', path: entry.path };
  }
  const runtime = runtimeFiles[entry.id];
  const file = runtime || (entry.localUri ? buildLocalPlayFileFromUri(entry.name, entry.path, entry.localUri) : undefined);
  return { source: 'local', path: entry.path, file };
};
