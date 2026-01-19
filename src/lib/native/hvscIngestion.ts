import { registerPlugin } from '@capacitor/core';

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
  phase: string;
  message: string;
  percent?: number;
};

export type HvscIngestionPlugin = {
  getHvscStatus: () => Promise<HvscStatus>;
  checkForHvscUpdates: () => Promise<HvscUpdateStatus>;
  installOrUpdateHvsc: (options: { cancelToken: string }) => Promise<HvscStatus>;
  cancelHvscInstall: (options: { cancelToken: string }) => Promise<void>;
  getHvscFolderListing: (options: { path: string }) => Promise<HvscFolderListing>;
  getHvscSong: (options: { id?: number; virtualPath?: string }) => Promise<HvscSong>;
  getHvscDurationByMd5: (options: { md5: string }) => Promise<{ durationSeconds?: number | null }>;
  addListener: (
    eventName: 'progress',
    listenerFunc: (event: HvscProgressEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

export const HvscIngestion = registerPlugin<HvscIngestionPlugin>('HvscIngestion', {
  web: () => import('./hvscIngestion.web.ts').then((module) => new module.HvscIngestionWeb()),
});
