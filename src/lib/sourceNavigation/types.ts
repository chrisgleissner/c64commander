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

export type SourceRecursiveFailure = {
  path: string;
  message: string;
};

export type SourceRecursiveResult = SourceEntry[] & {
  partialFailures?: SourceRecursiveFailure[];
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
  listFilesRecursive: (
    path: string,
    // `onProgress(delta)` reports newly-discovered file entries as the recursive
    // walk proceeds (delta = files found since the previous call), so a slow
    // broad-folder scan shows climbing progress instead of a stuck "0 items"
    // (S2-DISKS-FTP-RECURSIVE-SCAN-STALL). Adapters without incremental reporting
    // may omit it; callers backfill the remainder when the walk returns.
    options?: { signal?: AbortSignal; onProgress?: (delta: number) => void },
  ) => Promise<SourceRecursiveResult>;
  clearCacheForPath?: (path: string) => void;
};
