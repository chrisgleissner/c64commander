/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type HvscIngestionState = 'idle' | 'installing' | 'updating' | 'ready' | 'error';

export type HvscStatus = {
  installedBaselineVersion?: number | null;
  installedVersion: number;
  ingestionState: HvscIngestionState;
  lastUpdateCheckUtcMs?: number | null;
  ingestionError?: string | null;
};

export type HvscUpdateStatus = {
  latestVersion: number;
  installedVersion: number;
  baselineVersion?: number | null;
  requiredUpdates: number[];
};

export type HvscCacheStatus = {
  baselineVersion?: number | null;
  updateVersions: number[];
};

export type HvscFolderListing = {
  path: string;
  folders: string[];
  songs: Array<{
    id: number;
    virtualPath: string;
    fileName: string;
    durationSeconds?: number | null;
    durationsSeconds?: number[] | null;
    subsongCount?: number | null;
  }>;
};

export type HvscSong = {
  id: number;
  virtualPath: string;
  fileName: string;
  durationSeconds?: number | null;
  durationsSeconds?: number[] | null;
  subsongCount?: number | null;
  md5?: string | null;
  dataBase64: string;
};

export type HvscProgressEvent = {
  ingestionId: string;
  stage: string;
  message: string;
  archiveName?: string;
  currentFile?: string;
  processedCount?: number;
  totalCount?: number;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  songsUpserted?: number;
  songsDeleted?: number;
  elapsedTimeMs?: number;
  errorType?: string;
  errorCause?: string;
};
