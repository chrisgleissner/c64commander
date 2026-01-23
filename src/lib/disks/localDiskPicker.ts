import { FolderPicker, type PickedFolderEntry } from '@/lib/native/folderPicker';
import { coerceFolderPickerEntries } from '@/lib/native/folderPickerUtils';
import { getPlatform } from '@/lib/native/platform';
import type { DiskEntry } from './diskTypes';
import { createDiskEntry, getLeafFolderName, isDiskImagePath, normalizeDiskPath } from './diskTypes';
import { assignDiskGroupsByPrefix } from './diskGrouping';

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
  const rootName = result.rootName || '';
  const entries = coerceFolderPickerEntries(result.files);
  return { entries: entries ?? [], rootName };
};

const applyRootName = (path: string, rootName: string) => {
  if (!rootName) return path;
  const normalized = normalizeDiskPath(path);
  if (normalized.startsWith(`/${rootName}/`) || normalized === `/${rootName}`) return normalized;
  return normalizeDiskPath(`/${rootName}${normalized}`);
};

export const importLocalDiskFolder = async (): Promise<LocalDiskSelection | null> => {
  if (getPlatform() === 'android') {
    const result = await FolderPicker.pickDirectory({ extensions: ['d64', 'g64', 'd71', 'g71', 'd81'] });
    const { entries, rootName } = normalizeFolderPickerEntries(result);
    const runtimeFiles: Record<string, File> = {};
    const diskCandidates = entries.filter((entry) => isDiskImagePath(entry.name));
    const groupMap = assignDiskGroupsByPrefix(
      diskCandidates.map((entry) => ({
        path: applyRootName(entry.path, rootName),
        name: entry.name,
      })),
    );
    const disks = diskCandidates.map((entry, index) => {
      const path = applyRootName(entry.path, rootName);
      const autoGroup = groupMap.get(normalizeDiskPath(path));
      const fallbackGroup = getLeafFolderName(path);
      return createDiskEntry({
        path,
        location: 'local',
        group: autoGroup ?? fallbackGroup ?? null,
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
  const diskCandidates = files.map((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      file,
      path: normalizeDiskPath(`${rootName}/${relativePath}`),
      name: file.name,
    };
  });
  const groupMap = assignDiskGroupsByPrefix(diskCandidates.map((entry) => ({ path: entry.path, name: entry.name })));
  const disks = diskCandidates.map((entry, index) => {
    const autoGroup = groupMap.get(entry.path);
    const fallbackGroup = getLeafFolderName(entry.path);
    const diskEntry = createDiskEntry({
      path: entry.path,
      location: 'local',
      group: autoGroup ?? fallbackGroup ?? null,
      sizeBytes: entry.file.size,
      modifiedAt: new Date(entry.file.lastModified).toISOString(),
      importOrder: index,
    });
    runtimeFiles[diskEntry.id] = entry.file;
    return diskEntry;
  });
  return { disks, runtimeFiles };
};

export const importLocalDiskFiles = (files: FileList | null): LocalDiskSelection => {
  if (!files || files.length === 0) return { disks: [], runtimeFiles: {} };
  const runtimeFiles: Record<string, File> = {};
  const diskCandidates = Array.from(files)
    .filter((file) => isDiskImagePath(file.name))
    .map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        file,
        path: normalizeDiskPath(relativePath),
        name: file.name,
      };
    });
  const groupMap = assignDiskGroupsByPrefix(diskCandidates.map((entry) => ({ path: entry.path, name: entry.name })));
  const disks = diskCandidates.map((entry) => {
    const autoGroup = groupMap.get(entry.path);
    const fallbackGroup = getLeafFolderName(entry.path);
    const diskEntry = createDiskEntry({
      path: entry.path,
      location: 'local',
      group: autoGroup ?? fallbackGroup ?? null,
      sizeBytes: entry.file.size,
      modifiedAt: new Date(entry.file.lastModified).toISOString(),
    });
    runtimeFiles[diskEntry.id] = entry.file;
    return diskEntry;
  });

  return { disks, runtimeFiles };
};

export const importLocalDiskFolderFromInput = (files: FileList | null): LocalDiskSelection => {
  if (!files || files.length === 0) return { disks: [], runtimeFiles: {} };
  const runtimeFiles: Record<string, File> = {};
  const first = files[0] as File & { webkitRelativePath?: string };
  const rootName = first?.webkitRelativePath?.split('/')?.[0] || null;
  const diskCandidates = Array.from(files)
    .filter((file) => isDiskImagePath(file.name))
    .map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        file,
        path: normalizeDiskPath(relativePath),
        name: file.name,
      };
    });
  const groupMap = assignDiskGroupsByPrefix(diskCandidates.map((entry) => ({ path: entry.path, name: entry.name })));
  const disks = diskCandidates.map((entry, index) => {
    const autoGroup = groupMap.get(entry.path);
    const fallbackGroup = getLeafFolderName(entry.path) ?? rootName;
    const diskEntry = createDiskEntry({
      path: entry.path,
      location: 'local',
      group: autoGroup ?? fallbackGroup ?? null,
      sizeBytes: entry.file.size,
      modifiedAt: new Date(entry.file.lastModified).toISOString(),
      importOrder: index,
    });
    runtimeFiles[diskEntry.id] = entry.file;
    return diskEntry;
  });

  return { disks, runtimeFiles };
};
