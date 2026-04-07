/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type SourceEntryType = "file" | "dir";

export type SourceEntry = {
  type: SourceEntryType;
  name: string;
  path: string;
  subtitle?: string | null;
  durationMs?: number;
  songNr?: number;
  subsongCount?: number;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SourceLocationType = "ultimate" | "local" | "hvsc" | "commoserve";

export type SelectedItem = {
  type: SourceEntryType;
  name: string;
  path: string;
  durationMs?: number;
  songNr?: number;
  subsongCount?: number;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SourceEntryPage = {
  entries: SourceEntry[];
  totalCount: number;
  nextOffset: number | null;
};

export type SourceLocation = {
  id: string;
  type: SourceLocationType;
  name: string;
  rootPath: string;
  isAvailable: boolean;
  listEntries: (path: string) => Promise<SourceEntry[]>;
  listEntriesPage?: (options: {
    path: string;
    query?: string;
    offset?: number;
    limit?: number;
  }) => Promise<SourceEntryPage>;
  listFilesRecursive: (path: string, options?: { signal?: AbortSignal }) => Promise<SourceEntry[]>;
  clearCacheForPath?: (path: string) => void;
};
