/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  HvscCacheStatus,
  HvscFolderListing,
  HvscFolderListingPage,
  HvscProgressEvent,
  HvscSong,
  HvscStatus,
  HvscUpdateStatus,
} from "./hvscTypes";
import { Capacitor } from "@capacitor/core";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { createHvscMediaIndex } from "./hvscMediaIndex";
import type { SongLengthResolveQuery, SongLengthResolution } from "@/lib/songlengths";
import { addErrorLog, addLog } from "@/lib/logging";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import {
  loadHvscBrowseIndexSnapshot,
  verifyHvscBrowseIndexIntegrity,
  buildHvscBrowseIndexFromEntries,
  saveHvscBrowseIndexSnapshot,
} from "./hvscBrowseIndexStore";
import { beginHvscPerfScope, endHvscPerfScope, runWithHvscPerfScope } from "./hvscPerformance";
import { nextCorrelationId } from "@/lib/tracing/traceIds";
import { recordHvscQueryTiming } from "./hvscStatusStore";
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
} from "./hvscIngestionRuntime";
import { resolveHvscSonglengthDuration } from "./hvscSongLengthService";

export type HvscProgressListener = (event: HvscProgressEvent) => void;

type HvscMockBridge = Record<string, any>;

const getBrowserWindow = () =>
  typeof window === "undefined" ? undefined : (window as Window & { __hvscMock__?: HvscMockBridge });

const hasMockBridge = () => Boolean(getBrowserWindow()?.__hvscMock__);
const getMockBridge = () => getBrowserWindow()?.__hvscMock__;
const hasRuntimeBridge = () => {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform() || Capacitor.isPluginAvailable("Filesystem");
  } catch (error) {
    const err = error as Error;
    addErrorLog("HVSC runtime bridge probe failed", {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });
    return false;
  }
};

const hvscIndex = createHvscMediaIndex();

const LEGACY_MEDIA_INDEX_STORAGE_KEY = "c64u_media_index:v1";

const migrateLegacyMediaIndex = async () => {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(LEGACY_MEDIA_INDEX_STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      entries?: Array<{
        path: string;
        name: string;
        type: string;
        durationSeconds?: number | null;
      }>;
    };
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return false;
    hvscIndex.setEntries(
      parsed.entries
        .filter((entry) => entry.type === "sid")
        .map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: "sid" as const,
          durationSeconds: entry.durationSeconds ?? null,
        })),
    );
    await hvscIndex.save();
    return true;
  } catch (error) {
    addErrorLog("Failed to migrate legacy HVSC media index", {
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    return false;
  }
};

export const isHvscBridgeAvailable = () => hasMockBridge() || hasRuntimeBridge();

/**
 * Rebuild the browse index snapshot from the native SQLite song index.
 * Returns the snapshot on success, or null on failure / empty index.
 */
const rebuildBrowseIndexFromNative = async () => {
  try {
    const { HvscIngestion } = await import("@/lib/native/hvscIngestion");
    const nativeSongs = await HvscIngestion.queryAllSongs();
    if (nativeSongs.totalSongs === 0) return null;
    const entries = nativeSongs.songs.map((s) => ({
      path: s.virtualPath,
      name: s.fileName,
      type: "sid" as const,
    }));
    const snapshot = buildHvscBrowseIndexFromEntries(entries);
    await saveHvscBrowseIndexSnapshot(snapshot);
    addLog(`Rebuilt HVSC browse index from native SQLite: ${nativeSongs.totalSongs} songs`);
    return snapshot;
  } catch (error) {
    addErrorLog("Failed to rebuild HVSC browse index from native SQLite", {
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    return null;
  }
};

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
  if (mock?.addListener) return mock.addListener("progress", listener);
  return addRuntimeListener(listener);
};

const ensureHvscIndexReady = async () => {
  // Root and folder browsing only need the persisted browse snapshot. Avoid
  // eagerly loading the full media-index JSON on the first browse because that
  // blocks large real-HVSC libraries before any folder rows can render.
  let browseSnapshot = await hvscIndex.loadBrowseSnapshot();
  if (!browseSnapshot) {
    const migrated = await migrateLegacyMediaIndex();
    if (migrated) {
      browseSnapshot = await hvscIndex.loadBrowseSnapshot();
    }
  }
  // If the browse snapshot is still missing (e.g. after native ingest which
  // clears it, or after an app update) or stale/empty (was rebuilt lazily with
  // 0 entries from a prior cycle), try to rebuild from the native SQLite index.
  const snapshotMissingOrEmpty = !browseSnapshot || (browseSnapshot && Object.keys(browseSnapshot.songs).length === 0);
  if (snapshotMissingOrEmpty && hasRuntimeBridge()) {
    browseSnapshot = await rebuildBrowseIndexFromNative();
  }
  if (!browseSnapshot) return;

  const integrity = await verifyHvscBrowseIndexIntegrity(browseSnapshot);
  if (!integrity.isValid) {
    hvscIndex.clearBrowseSnapshot();
  }
};

const pageRuntimeListing = (
  listing: HvscFolderListing,
  query: string,
  offset: number,
  limit: number,
): HvscFolderListingPage => {
  const normalizedQuery = query.trim().toLowerCase();
  const folders = listing.folders
    .filter((folder) => normalizedQuery.length === 0 || folder.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b));
  const songs = listing.songs
    .filter(
      (song) =>
        normalizedQuery.length === 0 ||
        song.fileName.toLowerCase().includes(normalizedQuery) ||
        song.virtualPath.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  return {
    path: listing.path,
    folders,
    songs: songs.slice(offset, offset + limit),
    totalFolders: folders.length,
    totalSongs: songs.length,
    offset,
    limit,
    query: normalizedQuery,
  };
};

export const getHvscFolderListingPaged = async (options: {
  path: string;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<HvscFolderListingPage> => {
  const path = normalizeSourcePath(options.path || "/");
  const query = options.query ?? "";
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.floor(options.limit ?? 200));
  const correlationId = nextCorrelationId();
  const queryStartMs = performance.now();
  const queryPerfScope = beginHvscPerfScope("browse:query", {
    correlationId,
    path,
    query,
    offset,
    limit,
  });

  const finalizePage = (page: HvscFolderListingPage, phase: string) => {
    const resultCount = page.songs.length + page.folders.length;
    const windowMs = Math.round((performance.now() - queryStartMs) * 100) / 100;
    endHvscPerfScope(queryPerfScope, {
      phase,
      correlationId,
      path,
      query,
      offset,
      limit,
      resultCount,
      totalSongs: page.totalSongs,
      totalFolders: page.totalFolders,
    });
    recordHvscQueryTiming({
      correlationId,
      phase,
      path,
      query,
      offset,
      limit,
      resultCount,
      windowMs,
      timestamp: new Date().toISOString(),
    });
    void recordSmokeBenchmarkSnapshot({
      scenario: "browse-query",
      state: phase,
      metadata: {
        correlationId,
        path,
        query,
        offset,
        limit,
        resultCount,
        totalSongs: page.totalSongs,
        totalFolders: page.totalFolders,
        windowMs,
      },
    });
    return page;
  };

  try {
    await ensureHvscIndexReady();
    const page = hvscIndex.queryFolderPage({
      path,
      query,
      offset,
      limit,
    });
    if (page.totalFolders > 0 || page.totalSongs > 0 || !isHvscBridgeAvailable()) {
      return finalizePage(page, "index");
    }
    const mock = getMockBridge();
    if (mock?.getHvscFolderListing) {
      const runtimeListing = await mock.getHvscFolderListing({ path });
      const result = pageRuntimeListing(runtimeListing, query, offset, limit);
      return finalizePage(result, "mock-runtime");
    }
    const runtimeListing = await getRuntimeFolderListing(path);
    const result = pageRuntimeListing(runtimeListing, query, offset, limit);
    return finalizePage(result, "runtime");
  } catch (error) {
    const err = error as Error;
    addLog("info", "HVSC paged folder listing failed; falling back to runtime", {
      correlationId,
      path,
      query,
      offset,
      limit,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });
    const mock = getMockBridge();
    if (mock?.getHvscFolderListing) {
      const runtimeListing = await mock.getHvscFolderListing({ path });
      const result = pageRuntimeListing(runtimeListing, query, offset, limit);
      return finalizePage(result, "mock-runtime-fallback");
    }
    const runtimeListing = await getRuntimeFolderListing(path);
    const result = pageRuntimeListing(runtimeListing, query, offset, limit);
    return finalizePage(result, "runtime-fallback");
  }
};

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> => {
  const page = await getHvscFolderListingPaged({
    path,
    offset: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });
  return {
    path: page.path,
    folders: page.folders,
    songs: page.songs,
  };
};

/**
 * Fast synchronous bulk listing of all songs under a folder.
 * Reads directly from the in-memory browse index — no async I/O,
 * no per-page smoke snapshots. Returns null if the index is not loaded.
 */
export const getHvscSongsRecursive = async (
  path: string,
): Promise<ReturnType<typeof hvscIndex.querySongsRecursive>> => {
  await ensureHvscIndexReady();
  return hvscIndex.querySongsRecursive(path);
};

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> => {
  return runWithHvscPerfScope(
    "playback:load-sid",
    async () => {
      const mock = getMockBridge();
      if (mock?.getHvscSong) return mock.getHvscSong(options);
      return getRuntimeSong(options);
    },
    {
      id: options.id ?? null,
      virtualPath: options.virtualPath ?? null,
    },
  );
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

export const resolveHvscSonglength = async (query: SongLengthResolveQuery): Promise<SongLengthResolution> => {
  const mock = getMockBridge();
  if (mock?.resolveHvscSonglengthDuration) {
    return mock.resolveHvscSonglengthDuration(query);
  }
  return resolveHvscSonglengthDuration(query);
};

export const __test__ = {
  pageRuntimeListing,
};
