import { Capacitor } from '@capacitor/core';
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
import { HvscIngestion } from './native/hvscIngestion';

export type HvscProgressListener = (event: HvscProgressEvent) => void;

const hasMockBridge = () => Boolean((window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__);

const hvscIndex = createHvscMediaIndex();

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
      return HvscIngestion.getHvscFolderListing({ path });
    }
    return buildFolderListingFromIndex(path, entries);
  } catch {
    return HvscIngestion.getHvscFolderListing({ path });
  }
};

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> =>
  HvscIngestion.getHvscSong(options);

export const getHvscDurationByMd5Seconds = async (md5: string) => {
  const result = await HvscIngestion.getHvscDurationByMd5({ md5 });
  return result.durationSeconds;
};
