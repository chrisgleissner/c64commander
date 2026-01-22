import { FolderPicker, type PickedFolderEntry } from '@/lib/native/folderPicker';
import { coerceFolderPickerEntries } from '@/lib/native/folderPickerUtils';
import { getPlatform } from '@/lib/native/platform';
import type { LocalSidFile } from './LocalFsSongSource';
import { ingestLocalArchives, isSupportedLocalArchive } from './localArchiveIngestion';

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

const isSupportedLocalFile = (name: string) =>
  name.toLowerCase().endsWith('.sid') || isSupportedLocalArchive(name);

export const filterLocalInputFiles = (files: FileList | null): LocalSidFile[] => {
  if (!files || files.length === 0) return [];
  return Array.from(files).filter((file) => isSupportedLocalFile(file.name));
};

const normalizeFolderPickerEntries = (result: FolderPickerResult | null): PickedFolderEntry[] => {
  if (!result) {
    throw new Error('Folder picker returned no data.');
  }
  const entries = coerceFolderPickerEntries(result.files);
  if (entries === null) {
    throw new Error('Folder picker returned an invalid file list.');
  }
  return entries;
};

const toLocalFile = (entry: FolderPicker.PickedFolderEntry): LocalSidFile => {
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

export const browseLocalSidFiles = async (input: HTMLInputElement | null): Promise<LocalSidFile[] | null> => {
  if (getPlatform() === 'android') {
    const result = await FolderPicker.pickDirectory();
    const entries = normalizeFolderPickerEntries(result);
    const candidates = entries.filter((entry) => isSupportedLocalFile(entry.name)).map(toLocalFile);
    const ingestion = await ingestLocalArchives(candidates);
    return ingestion.files;
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
        if (!isSupportedLocalFile(file.name)) continue;
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
  const ingestion = await ingestLocalArchives(files);
  return ingestion.files;
};
