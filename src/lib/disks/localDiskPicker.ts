import { Capacitor } from '@capacitor/core';
import { FolderPicker, type PickedFolderEntry } from '@/lib/native/folderPicker';
import type { DiskEntry } from './diskTypes';
import { createDiskEntry, isDiskImagePath, normalizeDiskPath } from './diskTypes';

export type LocalDiskSelection = {
  disks: DiskEntry[];
  runtimeFiles: Record<string, File>;
};

type FileSystemHandleLike = {
  kind: 'file' | 'directory';
  name: string;
};

type FileSystemFileHandleLike = FileSystemHandleLike & {
  kind: 'file';
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = FileSystemHandleLike & {
  kind: 'directory';
  entries: () => AsyncIterableIterator<[string, FileSystemHandleLike]>;
};

type FolderPickerResult = {
  uri?: string;
  files?: unknown;
  rootName?: string;
};

const isDirectoryHandle = (handle: FileSystemHandleLike): handle is FileSystemDirectoryHandleLike =>
  handle.kind === 'directory' && 'entries' in handle;

export const prepareDiskDirectoryInput = (input: HTMLInputElement | null) => {
  if (!input) return;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
};

const normalizeFolderPickerEntries = (result: FolderPickerResult | null): { entries: PickedFolderEntry[]; rootName: string } => {
  if (!result) throw new Error('Folder picker returned no data.');
  const files = result.files;
  const rootName = result.rootName || '';
  if (!files) return { entries: [], rootName };
  if (Array.isArray(files)) return { entries: files as PickedFolderEntry[], rootName };
  if (typeof files === 'object' && 'length' in files) {
    return { entries: Array.from(files as ArrayLike<PickedFolderEntry>), rootName };
  }
  if (typeof files === 'object' && Symbol.iterator in files) {
    return { entries: Array.from(files as Iterable<PickedFolderEntry>), rootName };
  }
  return { entries: [], rootName };
};

const applyRootName = (path: string, rootName: string) => {
  if (!rootName) return path;
  const normalized = normalizeDiskPath(path);
  if (normalized.startsWith(`/${rootName}/`) || normalized === `/${rootName}`) return normalized;
  return normalizeDiskPath(`/${rootName}${normalized}`);
};

export const importLocalDiskFolder = async (): Promise<LocalDiskSelection | null> => {
  if (Capacitor.getPlatform() === 'android') {
    const result = await FolderPicker.pickDirectory({ extensions: ['d64', 'g64', 'd71', 'g71', 'd81'] });
    const { entries, rootName } = normalizeFolderPickerEntries(result);
    const runtimeFiles: Record<string, File> = {};
    const groupName = rootName || null;
    const disks = entries
      .filter((entry) => isDiskImagePath(entry.name))
      .map((entry, index) => {
        const path = applyRootName(entry.path, rootName);
        return createDiskEntry({
          path,
          location: 'local',
          group: groupName,
          localUri: entry.uri,
          modifiedAt: null,
          sizeBytes: null,
          importOrder: index,
        });
      });
    return { disks, runtimeFiles };
  }

  const picker = (window as Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  }).showDirectoryPicker;

  if (!picker) {
    return null;
  }

  const directoryHandle = await picker();
  const files: File[] = [];
  const rootName = directoryHandle.name;

  const walkDirectory = async (dirHandle: FileSystemDirectoryHandleLike, prefix: string) => {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandleLike).getFile();
        if (!isDiskImagePath(file.name)) continue;
        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${prefix}${name}`,
        });
        files.push(file);
      } else if (isDirectoryHandle(handle)) {
        await walkDirectory(handle, `${prefix}${name}/`);
      }
    }
  };

  await walkDirectory(directoryHandle, '');
  const runtimeFiles: Record<string, File> = {};
  const disks = files.map((file, index) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizeDiskPath(`${rootName}/${relativePath}`);
    const entry = createDiskEntry({
      path,
      location: 'local',
      group: rootName || null,
      sizeBytes: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      importOrder: index,
    });
    runtimeFiles[entry.id] = file;
    return entry;
  });
  return { disks, runtimeFiles };
};

export const importLocalDiskFiles = (files: FileList | null): LocalDiskSelection => {
  if (!files || files.length === 0) return { disks: [], runtimeFiles: {} };
  const runtimeFiles: Record<string, File> = {};
  const disks: DiskEntry[] = [];

  Array.from(files).forEach((file) => {
    if (!isDiskImagePath(file.name)) return;
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizeDiskPath(relativePath);
    const entry = createDiskEntry({
      path,
      location: 'local',
      sizeBytes: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
    });
    runtimeFiles[entry.id] = file;
    disks.push(entry);
  });

  return { disks, runtimeFiles };
};

export const importLocalDiskFolderFromInput = (files: FileList | null): LocalDiskSelection => {
  if (!files || files.length === 0) return { disks: [], runtimeFiles: {} };
  const runtimeFiles: Record<string, File> = {};
  const disks: DiskEntry[] = [];
  const first = files[0] as File & { webkitRelativePath?: string };
  const rootName = first?.webkitRelativePath?.split('/')?.[0] || null;

  Array.from(files).forEach((file, index) => {
    if (!isDiskImagePath(file.name)) return;
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizeDiskPath(relativePath);
    const entry = createDiskEntry({
      path,
      location: 'local',
      group: rootName,
      sizeBytes: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      importOrder: index,
    });
    runtimeFiles[entry.id] = file;
    disks.push(entry);
  });

  return { disks, runtimeFiles };
};
