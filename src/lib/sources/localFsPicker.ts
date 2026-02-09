/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { buildLocalPlayFileFromTree } from '@/lib/playback/fileLibraryUtils';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
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

const isDirectoryHandle = (handle: FileSystemHandleLike): handle is FileSystemDirectoryHandleLike =>
  handle.kind === 'directory' && 'entries' in handle;

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

const listSafFiles = async (treeUri: string): Promise<{ name: string; path: string }[]> => {
  const queue = ['/'];
  const files: { name: string; path: string }[] = [];
  while (queue.length) {
    const path = queue.shift();
    if (!path) continue;
    const response = await FolderPicker.listChildren({ treeUri, path });
    response.entries.forEach((entry) => {
      if (entry.type === 'dir') {
        queue.push(normalizeSourcePath(entry.path));
      } else {
        files.push({ name: entry.name, path: normalizeSourcePath(entry.path) });
      }
    });
  }
  return files;
};

export const browseLocalSidFiles = async (input: HTMLInputElement | null): Promise<LocalSidFile[] | null> => {
  if (getPlatform() === 'android') {
    const result = await FolderPicker.pickDirectory();
    const treeUri = result?.treeUri;
    if (!treeUri || result?.files != null || !result?.permissionPersisted) {
      throw new Error('Android SAF picker returned an unsupported response.');
    }
    const entries = await listSafFiles(treeUri);
    const candidates = entries
      .filter((entry) => isSupportedLocalFile(entry.name))
      .map((entry) => buildLocalPlayFileFromTree(entry.name, entry.path, treeUri));
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
