/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type HvscIngestionState = 'idle' | 'installing' | 'updating' | 'ready' | 'error';

export type HvscSidClock = 'unknown' | 'pal' | 'ntsc' | 'pal_ntsc';
export type HvscSidModel = 'unknown' | 'mos6581' | 'mos8580' | 'both';

export type HvscSidMetadata = {
  magicId: 'PSID' | 'RSID';
  version: number;
  songs: number;
  startSong: number;
  clock: HvscSidClock;
  sid1Model: HvscSidModel;
  sid2Model: HvscSidModel | null;
  sid3Model: HvscSidModel | null;
  sid2Adress: number | null;
  sid2Address: number | null;
  name: string;
  author: string;
  released: string;
  rsidValid: boolean | null;
  parserWarnings: string[];
};

export type HvscTrackSubsong = {
  songNr: number;
  isDefault: boolean;
};

export type HvscIngestionSummary = {
  totalSongs: number;
  ingestedSongs: number;
  failedSongs: number;
  songlengthSyntaxErrors: number;
  failedPaths: string[];
  completedAt: string;
  archiveName?: string;
};

export type HvscStatus = {
  installedBaselineVersion?: number | null;
  installedVersion: number;
  ingestionState: HvscIngestionState;
  lastUpdateCheckUtcMs?: number | null;
  ingestionError?: string | null;
  ingestionSummary?: HvscIngestionSummary | null;
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

export type HvscFolderListingPage = {
  path: string;
  folders: string[];
  songs: Array<{
    id: number;
    virtualPath: string;
    fileName: string;
    durationSeconds?: number | null;
    sidMetadata?: HvscSidMetadata | null;
    trackSubsongs?: HvscTrackSubsong[] | null;
  }>;
  totalFolders: number;
  totalSongs: number;
  offset: number;
  limit: number;
  query?: string;
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
  totalSongs?: number;
  ingestedSongs?: number;
  failedSongs?: number;
  songlengthSyntaxErrors?: number;
  errorType?: string;
  errorCause?: string;
};
