import { Capacitor } from '@capacitor/core';
import type {
  HvscCacheStatus,
  HvscFolderListing,
  HvscProgressEvent,
  HvscSong,
  HvscStatus,
  HvscUpdateStatus,
} from './hvscTypes';
import { HvscIngestion } from './native/hvscIngestion';

export type HvscProgressListener = (event: HvscProgressEvent) => void;

const hasMockBridge = () => Boolean((window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__);

export const isHvscBridgeAvailable = () => Capacitor.getPlatform() !== 'web' || hasMockBridge();

export const getHvscStatus = async (): Promise<HvscStatus> => HvscIngestion.getHvscStatus();

export const getHvscCacheStatus = async (): Promise<HvscCacheStatus> =>
  HvscIngestion.getHvscCacheStatus();

export const checkForHvscUpdates = async (): Promise<HvscUpdateStatus> =>
  HvscIngestion.checkForHvscUpdates();

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> =>
  HvscIngestion.installOrUpdateHvsc({ cancelToken });

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> =>
  HvscIngestion.ingestCachedHvsc({ cancelToken });

export const cancelHvscInstall = async (cancelToken: string): Promise<void> =>
  HvscIngestion.cancelHvscInstall({ cancelToken });

export const addHvscProgressListener = async (listener: HvscProgressListener) =>
  HvscIngestion.addListener('progress', listener);

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> =>
  HvscIngestion.getHvscFolderListing({ path });

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> =>
  HvscIngestion.getHvscSong(options);

export const getHvscDurationByMd5Seconds = async (md5: string) => {
  const result = await HvscIngestion.getHvscDurationByMd5({ md5 });
  return result.durationSeconds;
};
