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
  /**
   * A third line, below the subtitle.
   *
   * Used by a search that spans the whole source to say where the result actually lives. Browsing a
   * folder does not need it — the path is already on screen — but a flat list of results drawn from
   * everywhere is ambiguous without it.
   */
  detail?: string | null;
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
  /**
   * Find files anywhere in this source, not only in the folder being browsed.
   *
   * `listEntriesPage`'s query narrows one folder row, which is the right behaviour for cutting a
   * long listing down and the wrong behaviour for finding something. A source arranged by composer
   * or by publisher hides everything one level deeper than wherever the person happens to be
   * standing, so a search that stops at the current level can only find what is already on screen.
   *
   * `path` restricts the search to a subtree; omitting it searches the whole source. Results are
   * flat files, so they carry `detail` saying which folder each one came from.
   */
  searchEntries?: (options: {
    query: string;
    path?: string;
    offset?: number;
    limit?: number;
    signal?: AbortSignal;
  }) => Promise<SourceEntryPage>;
  /**
   * Whether {@link searchEntries} answers from an index rather than by walking the source.
   *
   * An index lookup costs milliseconds and can run on every keystroke. A walk costs seconds to
   * minutes and must only run when it has been asked for, so the UI offers it as an action rather
   * than as a filter that fires while you type.
   */
  searchIsInstant?: boolean;
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
