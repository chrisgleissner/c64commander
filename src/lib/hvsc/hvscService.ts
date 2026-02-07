import type {
  HvscCacheStatus,
  HvscFolderListing,
  HvscProgressEvent,
  HvscSong,
  HvscStatus,
  HvscUpdateStatus,
} from './hvscTypes';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { createHvscMediaIndex } from './hvscMediaIndex';
import { loadHvscRoot } from './hvscRootLocator';
import { ensureHvscSonglengthsReadyOnColdStart } from './hvscSongLengthService';
import {
  addHvscProgressListener as addRuntimeListener,
  cancelHvscInstall as cancelRuntimeInstall,
  checkForHvscUpdates as checkRuntimeUpdates,
  getHvscCacheStatus as getRuntimeCacheStatus,
  getHvscDurationByMd5Seconds as getRuntimeDurationByMd5,
  getHvscFolderListing as getRuntimeFolderListing,
  getHvscSong as getRuntimeSong,
  getHvscStatus as getRuntimeStatus,
  ingestCachedHvsc as ingestRuntimeCached,
  installOrUpdateHvsc as installRuntime,
} from './hvscIngestionRuntime';
import { resolveHvscSonglengthDuration } from './hvscSongLengthService';

export type HvscProgressListener = (event: HvscProgressEvent) => void;

const hasMockBridge = () => Boolean((window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__);
const getMockBridge = () => (window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__;

const hvscIndex = createHvscMediaIndex();
void ensureHvscSonglengthsReadyOnColdStart();

export const isHvscBridgeAvailable = () => typeof window !== 'undefined' || hasMockBridge();

export const getHvscStatus = async (): Promise<HvscStatus> => {
  const mock = getMockBridge();
  if (mock?.getHvscStatus) return mock.getHvscStatus();
  return getRuntimeStatus();
};

export const getHvscCacheStatus = async (): Promise<HvscCacheStatus> => {
  const mock = getMockBridge();
  if (mock?.getHvscCacheStatus) return mock.getHvscCacheStatus();
  return getRuntimeCacheStatus();
};

export const checkForHvscUpdates = async (): Promise<HvscUpdateStatus> => {
  const mock = getMockBridge();
  if (mock?.checkForHvscUpdates) return mock.checkForHvscUpdates();
  return checkRuntimeUpdates();
};

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  const mock = getMockBridge();
  if (mock?.installOrUpdateHvsc) return mock.installOrUpdateHvsc({ cancelToken });
  return installRuntime(cancelToken);
};

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  const mock = getMockBridge();
  if (mock?.ingestCachedHvsc) return mock.ingestCachedHvsc({ cancelToken });
  return ingestRuntimeCached(cancelToken);
};

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  const mock = getMockBridge();
  if (mock?.cancelHvscInstall) return mock.cancelHvscInstall({ cancelToken });
  return cancelRuntimeInstall(cancelToken);
};

export const addHvscProgressListener = async (listener: HvscProgressListener) => {
  const mock = getMockBridge();
  if (mock?.addListener) return mock.addListener('progress', listener);
  return addRuntimeListener(listener);
};

const buildFolderListingFromIndex = (path: string, entries: Array<{ path: string; name: string; durationSeconds?: number | null }>): HvscFolderListing => {
  const normalized = normalizeSourcePath(path || '/');
  const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const folders = new Set<string>();
  const songs: HvscFolderListing['songs'] = [];

  entries.forEach((entry) => {
    const dir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
    folders.add(dir);
    if (!entry.path.startsWith(prefix)) return;
    const remainder = entry.path.slice(prefix.length);
    if (!remainder || remainder.includes('/')) return;
    songs.push({
      id: Math.abs(
        Array.from(entry.path).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0),
      ),
      virtualPath: entry.path,
      fileName: entry.name,
      durationSeconds: entry.durationSeconds ?? null,
    });
  });

  return {
    path: normalized,
    folders: Array.from(folders).sort((a, b) => a.localeCompare(b)),
    songs: songs.sort((a, b) => a.fileName.localeCompare(b.fileName)),
  };
};

const ensureHvscIndexReady = async () => {
  await hvscIndex.load();
  if (hvscIndex.getAll().length) return;
  const root = loadHvscRoot();
  await hvscIndex.scan([root.path]);
};

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> => {
  try {
    await ensureHvscIndexReady();
    const entries = hvscIndex.getAll().map((entry) => ({
      path: entry.path,
      name: entry.name,
      durationSeconds: entry.durationSeconds ?? null,
    }));
    if (!entries.length && isHvscBridgeAvailable()) {
      const mock = getMockBridge();
      if (mock?.getHvscFolderListing) return mock.getHvscFolderListing({ path });
      return getRuntimeFolderListing(path);
    }
    return buildFolderListingFromIndex(path, entries);
  } catch {
    const mock = getMockBridge();
    if (mock?.getHvscFolderListing) return mock.getHvscFolderListing({ path });
    return getRuntimeFolderListing(path);
  }
};

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> => {
  const mock = getMockBridge();
  if (mock?.getHvscSong) return mock.getHvscSong(options);
  return getRuntimeSong(options);
};

export const getHvscDurationByMd5Seconds = async (md5: string) => {
  const mock = getMockBridge();
  if (mock?.getHvscDurationByMd5) {
    const result = await mock.getHvscDurationByMd5({ md5 });
    return result.durationSeconds ?? null;
  }
  return getRuntimeDurationByMd5(md5);
};

export const getHvscDurationsByMd5Seconds = async (md5: string) => {
  const mock = getMockBridge();
  if (mock?.getHvscDurationsByMd5) {
    const result = await mock.getHvscDurationsByMd5({ md5 });
    return result.durationsSeconds ?? null;
  }
  const resolution = await resolveHvscSonglengthDuration({ md5 });
  if (resolution.durations?.length) return resolution.durations;
  return resolution.durationSeconds !== null ? [resolution.durationSeconds] : null;
};
