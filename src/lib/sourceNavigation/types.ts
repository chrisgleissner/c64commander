/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type SourceEntryType = 'file' | 'dir';

export type SourceEntry = {
  type: SourceEntryType;
  name: string;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SourceLocationType = 'ultimate' | 'local' | 'hvsc';

export type SelectedItem = {
  type: SourceEntryType;
  name: string;
  path: string;
};

export type SourceLocation = {
  id: string;
  type: SourceLocationType;
  name: string;
  rootPath: string;
  isAvailable: boolean;
  listEntries: (path: string) => Promise<SourceEntry[]>;
  listFilesRecursive: (path: string, options?: { signal?: AbortSignal }) => Promise<SourceEntry[]>;
  clearCacheForPath?: (path: string) => void;
};