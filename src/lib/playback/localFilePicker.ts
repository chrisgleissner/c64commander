import { Capacitor } from '@capacitor/core';
import { FolderPicker, type PickedFolderEntry } from '@/lib/native/folderPicker';
import { SUPPORTED_PLAY_EXTENSIONS, getFileExtension } from './fileTypes';
import type { LocalPlayFile } from './playbackRouter';

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
};

const isDirectoryHandle = (handle: FileSystemHandleLike): handle is FileSystemDirectoryHandleLike =>
  handle.kind === 'directory' && 'entries' in handle;

const base64ToArrayBuffer = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const prepareDirectoryInput = (input: HTMLInputElement | null) => {
  if (!input) return;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
};

const normalizeFolderPickerEntries = (result: FolderPickerResult | null): PickedFolderEntry[] => {
  if (!result) {
    throw new Error('Folder picker returned no data.');
  }
  const files = result.files;
  if (!files) return [];
  if (Array.isArray(files)) return files as PickedFolderEntry[];
  if (typeof files === 'object' && 'length' in files) {
    return Array.from(files as ArrayLike<PickedFolderEntry>);
  }
  if (typeof files === 'object' && Symbol.iterator in files) {
    return Array.from(files as Iterable<PickedFolderEntry>);
  }
  return [];
};

const toLocalFile = (entry: PickedFolderEntry): LocalPlayFile => {
  if (!entry?.uri || !entry.name || !entry.path) {
    throw new Error('Folder picker entry is missing required fields.');
  }
  return {
    name: entry.name,
    webkitRelativePath: entry.path,
    lastModified: Date.now(),
    arrayBuffer: async () => {
      const data = await FolderPicker.readFile({ uri: entry.uri });
      return base64ToArrayBuffer(data.data);
    },
  };
};

const isSupportedPlayFile = (name: string) => SUPPORTED_PLAY_EXTENSIONS.has(getFileExtension(name));

export const browseLocalPlayFiles = async (input: HTMLInputElement | null): Promise<LocalPlayFile[] | null> => {
  if (Capacitor.getPlatform() === 'android') {
    const extensions = Array.from(SUPPORTED_PLAY_EXTENSIONS.values());
    const result = await FolderPicker.pickDirectory({ extensions });
    const entries = normalizeFolderPickerEntries(result);
    return entries.filter((entry) => isSupportedPlayFile(entry.name)).map(toLocalFile);
  }

  const picker = (window as Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  }).showDirectoryPicker;

  if (!picker) {
    input?.click();
    return null;
  }

  const directoryHandle = await picker();
  const files: File[] = [];

  const walkDirectory = async (dirHandle: FileSystemDirectoryHandleLike, prefix: string) => {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandleLike).getFile();
        if (!isSupportedPlayFile(file.name)) continue;
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
  return files;
};

export const filterPlayInputFiles = (files: FileList | null): LocalPlayFile[] => {
  if (!files || files.length === 0) return [];
  return Array.from(files).filter((file) => isSupportedPlayFile(file.name));
};
