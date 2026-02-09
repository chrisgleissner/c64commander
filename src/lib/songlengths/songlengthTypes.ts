/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type SongLengthSourceFile = {
  path: string;
  content: string;
};

export type SongLengthLoadInput = {
  configuredPath: string | null;
  sourceLabel: string;
  files: SongLengthSourceFile[];
};

export type SongLengthResolveQuery = {
  virtualPath?: string | null;
  fileName?: string | null;
  partialPath?: string | null;
  md5?: string | null;
  songNr?: number | null;
};

export type SongLengthResolveStrategy =
  | 'filename-unique'
  | 'filename-partial-path'
  | 'full-path'
  | 'md5'
  | 'unavailable'
  | 'not-found'
  | 'ambiguous';

export type SongLengthResolution = {
  durationSeconds: number | null;
  durations?: number[] | null;
  subsongCount?: number | null;
  strategy: SongLengthResolveStrategy;
  matchedPath?: string | null;
  matchedMd5?: string | null;
  fileName?: string | null;
  candidateCount?: number | null;
};

export type SongLengthBackendStats = {
  backend: string;
  configuredPath: string | null;
  sourceLabel: string | null;
  filesLoaded: string[];
  entriesTotal: number;
  uniqueFileNames: number;
  duplicatedFileNames: number;
  duplicateEntries: number;
  rejectedLines: number;
  fullPathIndexSize: number;
  md5IndexSize: number;
  estimatedMemoryBytes: number;
  loadedAtIso: string | null;
};

export type SongLengthServiceStats = {
  status: 'ready' | 'loading' | 'unavailable';
  unavailableReason: string | null;
  loadDurationMs: number | null;
  lastLoadedAtIso: string | null;
  backendStats: SongLengthBackendStats;
};
