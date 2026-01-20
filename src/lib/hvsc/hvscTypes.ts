export type HvscStatus = {
  installedBaselineVersion?: number | null;
  installedVersion: number;
  ingestionState: string;
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
  songs: Array<{ id: number; virtualPath: string; fileName: string; durationSeconds?: number | null }>;
};

export type HvscSong = {
  id: number;
  virtualPath: string;
  fileName: string;
  durationSeconds?: number | null;
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
