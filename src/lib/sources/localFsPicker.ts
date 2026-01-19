import { Capacitor } from '@capacitor/core';
import { FolderPicker } from '@/lib/native/folderPicker';
import type { LocalSidFile } from './LocalFsSongSource';

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

export const filterSidFiles = (files: FileList | null): LocalSidFile[] => {
  if (!files || files.length === 0) return [];
  return Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.sid'));
};

export const browseLocalSidFiles = async (input: HTMLInputElement | null): Promise<LocalSidFile[] | null> => {
  if (Capacitor.getPlatform() === 'android') {
    const result = await FolderPicker.pickDirectory();
    return result.files.map((entry) => ({
      name: entry.name,
      webkitRelativePath: entry.path,
      lastModified: Date.now(),
      arrayBuffer: async () => {
        const data = await FolderPicker.readFile({ uri: entry.uri });
        return base64ToArrayBuffer(data.data);
      },
    }));
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
        if (!file.name.toLowerCase().endsWith('.sid')) continue;
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
