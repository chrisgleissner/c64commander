import { registerPlugin } from '@capacitor/core';
import type {
  HvscCacheStatus,
  HvscFolderListing,
  HvscProgressEvent,
  HvscSong,
  HvscStatus,
  HvscUpdateStatus,
} from '../hvscTypes';

export type HvscIngestionPlugin = {
  getHvscStatus: () => Promise<HvscStatus>;
  getHvscCacheStatus: () => Promise<HvscCacheStatus>;
  checkForHvscUpdates: () => Promise<HvscUpdateStatus>;
  installOrUpdateHvsc: (options: { cancelToken: string }) => Promise<HvscStatus>;
  ingestCachedHvsc: (options: { cancelToken: string }) => Promise<HvscStatus>;
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
