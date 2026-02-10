/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

declare module '@capacitor/filesystem' {
  export enum Directory {
    Data = 'DATA',
    Cache = 'CACHE',
    Documents = 'DOCUMENTS',
    External = 'EXTERNAL',
    ExternalStorage = 'EXTERNAL_STORAGE',
  }

  export type FileInfo = {
    name: string;
    type?: 'file' | 'directory';
    size?: number;
    mtime?: number;
    uri?: string;
  };

  export type StatResult = {
    type: 'file' | 'directory';
    size?: number;
    mtime?: number;
    uri?: string;
  };

  export type ProgressStatus = { loaded: number; total?: number };

  export const Filesystem: {
    mkdir: (options: { directory: Directory; path: string; recursive?: boolean }) => Promise<void>;
    readFile: (options: { directory: Directory; path: string }) => Promise<{ data: string }>; 
    writeFile: (options: { directory: Directory; path: string; data: string }) => Promise<void>;
    readdir: (options: { directory: Directory; path: string }) => Promise<{ files: Array<FileInfo | string> }>;
    stat: (options: { directory: Directory; path: string }) => Promise<StatResult>;
    deleteFile: (options: { directory: Directory; path: string }) => Promise<void>;
    rmdir: (options: { directory: Directory; path: string; recursive?: boolean }) => Promise<void>;
    downloadFile: (options: {
      url: string;
      directory: Directory;
      path: string;
      progress?: (status: ProgressStatus) => void;
    }) => Promise<{ path?: string }>;
  };
}
