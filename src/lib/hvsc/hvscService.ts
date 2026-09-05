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
  getHvscSongFromBrowseIndex,
  saveHvscBrowseIndexSnapshot,
  verifyHvscBrowseIndexIntegrity,
  type HvscBrowseIndexSnapshot,
} from "./hvscBrowseIndexStore";
import { beginHvscPerfScope, endHvscPerfScope, runWithHvscPerfScope } from "./hvscPerformance";
import { nextCorrelationId } from "@/lib/tracing/traceIds";
import { recordHvscQueryTiming } from "./hvscStatusStore";
import { createProgressEmitter } from "./hvscIngestionProgress";
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
  resetHvscLibraryData as resetRuntimeLibraryData,
} from "./hvscIngestionRuntime";
import { ensureHvscSonglengthsReadyOnColdStart, resolveHvscSonglengthDuration } from "./hvscSongLengthService";
import { hydrateHvscMetadata } from "./hvscMetadataHydrator";
import { getHvscHydrationGeneration } from "./hvscHydrationControl";
import { getStilEntry } from "./stilStore";
import { primaryCredit, stripSectionTimestamp } from "./stilParser";

export type HvscProgressListener = (event: HvscProgressEvent) => void;

type HvscMockBridge = Record<string, any>;

const getBrowserWindow = () =>
  typeof window === "undefined" ? undefined : (window as Window & { __hvscMock__?: HvscMockBridge });

const hasMockBridge = () => Boolean(getBrowserWindow()?.__hvscMock__);
const getMockBridge = () => getBrowserWindow()?.__hvscMock__;
const hasMockIngestionBridge = () => {
  const mock = getMockBridge();
  return Boolean(mock?.installOrUpdateHvsc || mock?.ingestCachedHvsc);
};
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

const hasRuntimeIngestionBridge = () => {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("HvscIngestion");
  } catch (error) {
    const err = error as Error;
    addErrorLog("HVSC ingestion bridge probe failed", {
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
let hvscMetadataHydrationPromise: Promise<void> | null = null;

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
export const isHvscIngestionBridgeAvailable = () => hasMockIngestionBridge() || hasRuntimeIngestionBridge();

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

/*
 * Ingestion writes a browse index of its own (createHvscBrowseIndexMutable ... finalize), so
 * whatever this module had cached before it is stale the moment it finishes. Dropping the cache
 * here is what makes a freshly installed library searchable.
 *
 * Without it the app kept the snapshot it started with — for a device with no library, an EMPTY
 * one — and that snapshot is both what search reads and what the next save() persists. So a
 * library could install correctly, report its songs indexed, browse fine through the native
 * listing, and still answer every search with "Nothing found", while the empty snapshot was
 * written back over the populated one ingestion had just saved.
 */
const forgetCachedBrowseIndex = () => {
  hvscIndex.clearBrowseSnapshot();
  verifiedBrowseSnapshot = null;
};

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  const mock = getMockBridge();
  const status = mock?.installOrUpdateHvsc
    ? await mock.installOrUpdateHvsc({ cancelToken })
    : await installRuntime(cancelToken);
  forgetCachedBrowseIndex();
  return status;
};

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  const mock = getMockBridge();
  const status = mock?.ingestCachedHvsc
    ? await mock.ingestCachedHvsc({ cancelToken })
    : await ingestRuntimeCached(cancelToken);
  forgetCachedBrowseIndex();
  return status;
};

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  const mock = getMockBridge();
  if (mock?.cancelHvscInstall) return mock.cancelHvscInstall({ cancelToken });
  return cancelRuntimeInstall(cancelToken);
};

export const resetHvscLibraryData = async (): Promise<void> => {
  const mock = getMockBridge();
  if (mock?.resetHvscLibraryData) {
    return mock.resetHvscLibraryData();
  }
  return resetRuntimeLibraryData();
};

export const addHvscProgressListener = async (listener: HvscProgressListener) => {
  const mock = getMockBridge();
  if (mock?.addListener) return mock.addListener("progress", listener);
  return addRuntimeListener(listener);
};

export const ensureHvscMetadataHydration = async () => {
  if (hvscMetadataHydrationPromise) {
    return hvscMetadataHydrationPromise;
  }

  hvscMetadataHydrationPromise = (async () => {
    // HARD19-019: capture the hydration generation for this run. A reset or
    // reinstall bumps it; every persist below and the loop's shouldContinue()
    // are guarded against it, so a stale run cannot resurrect a deleted index or
    // clobber a fresh reinstall.
    const runGeneration = getHvscHydrationGeneration();
    const isCurrentGeneration = () => getHvscHydrationGeneration() === runGeneration;

    await ensureHvscSonglengthsReadyOnColdStart();
    const snapshot = await hvscIndex.loadBrowseSnapshot();
    if (!snapshot) {
      return;
    }
    if (!isCurrentGeneration()) {
      return;
    }

    const pendingSongs = Object.values(snapshot.songs).filter(
      (song) => song.metadataStatus !== "hydrated" && song.metadataStatus !== "error",
    );
    if (!pendingSongs.length) {
      return;
    }

    const emitProgress = createProgressEmitter("hvsc-metadata-hydration");
    // Persisting to disk is O(song count) - JSON-encoding and writing the
    // whole compact media index, plus (absent the foldersUnchanged fast path in
    // saveHvscBrowseIndexSnapshot, hvscBrowseIndexStore.ts) rebuilding the
    // folder tree. Doing that
    // after every small hydration chunk turned a real ~60k-song library scan
    // into an O(songs^2) main-thread hog lasting many minutes (observed
    // symptom: Remote Input stuck on "Reconnecting" and an unresponsive UI
    // even though the device itself was perfectly healthy). The in-memory
    // index is still updated every chunk so browsing/search see fresh
    // metadata immediately; only the expensive disk write is throttled, and
    // the final chunk always persists so no progress is lost on completion.
    let lastPersistedAtMs = 0;
    const persistIntervalMs = 5000;
    const hydratedSnapshot = await hydrateHvscMetadata({
      snapshot,
      readSong: async (virtualPath) => getHvscSong({ virtualPath }),
      emitProgress,
      shouldContinue: isCurrentGeneration,
      onSnapshotUpdated: async (nextSnapshot, isFinal) => {
        // HARD19-019: if a reset/reinstall raced in, do NOT touch the in-memory
        // index or write to disk — that is exactly the resurrection/clobber.
        if (!isCurrentGeneration()) return;
        hvscIndex.setBrowseSnapshot(nextSnapshot);
        const now = Date.now();
        if (!isFinal && now - lastPersistedAtMs < persistIntervalMs) return;
        lastPersistedAtMs = now;
        await saveHvscBrowseIndexSnapshot(nextSnapshot, { foldersUnchanged: true });
      },
    });
    if (isCurrentGeneration()) {
      hvscIndex.setBrowseSnapshot(hydratedSnapshot);
    }
  })()
    .catch((error) => {
      const emitProgress = createProgressEmitter("hvsc-metadata-hydration");
      emitProgress({
        stage: "sid_metadata_hydration",
        statusToken: "error",
        message: "HVSC META failed",
        errorCause: (error as Error).message,
      });
      addErrorLog("HVSC metadata hydration failed", {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
    })
    .finally(() => {
      hvscMetadataHydrationPromise = null;
    });

  return hvscMetadataHydrationPromise;
};

/**
 * The browse snapshot whose integrity has already been checked.
 *
 * Held by reference rather than by a key: a different object is a different load or rebuild, which
 * is exactly when the check is worth repeating, and reference equality costs nothing.
 *
 * The check stats twelve sampled songs over the Capacitor bridge and, when one is missing, DISCARDS
 * the snapshot. Running that on every folder query meant twelve bridge round trips per keystroke of
 * the folder filter, and — for a library where the sample does not resolve — throwing away a
 * snapshot that costs 1.7 s of main-thread work to rebuild, over and over, while the page kept
 * asking for folders. Once per snapshot catches the case it exists for (a snapshot describing a
 * library that has gone) without the thrash.
 */
let verifiedBrowseSnapshot: HvscBrowseIndexSnapshot | null = null;

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
  const snapshotMissingOrEmpty = !browseSnapshot || Object.keys(browseSnapshot.songs).length === 0;
  if (snapshotMissingOrEmpty) {
    await ensureHvscSonglengthsReadyOnColdStart();
    browseSnapshot = await hvscIndex.loadBrowseSnapshot();
  }
  if (!browseSnapshot) return;

  if (verifiedBrowseSnapshot === browseSnapshot) return;
  const integrity = await verifyHvscBrowseIndexIntegrity(browseSnapshot);
  if (!integrity.isValid) {
    verifiedBrowseSnapshot = null;
    hvscIndex.clearBrowseSnapshot();
    return;
  }
  verifiedBrowseSnapshot = browseSnapshot;
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
    // An empty page means one of two very different things, and the fallback below is only right for
    // one of them. "The index does not know this folder" deserves a native listing. "The query
    // matched nothing here" is a complete, correct answer — and falling back for it made every
    // keystroke that matched nothing enumerate the whole folder over the bridge, on a filter that is
    // typed a letter at a time. Asking the index for the same folder unfiltered separates the two,
    // and costs an in-memory lookup rather than a native call.
    if (query.trim()) {
      const unfiltered = hvscIndex.queryFolderPage({ path, query: "", offset: 0, limit: 1 });
      if (unfiltered.totalFolders > 0 || unfiltered.totalSongs > 0) {
        return finalizePage(page, "index-no-match");
      }
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
 * Search every tune in the archive by title, author or path.
 *
 * Answers from the in-memory browse index, so it costs a linear pass over the song table and no
 * I/O at all — fast enough to run while the listener is still typing. Returns null when the index
 * is not loaded, which the caller must show as "not ready" rather than "nothing found".
 *
 * Deliberately bypasses `ensureHvscIndexReady()` for the same reason `getHvscSongsRecursive` does:
 * its integrity check stat-probes virtual paths that do not exist as files, and a failed probe
 * destructively clears the snapshot.
 */
/**
 * Where the search has got to, readable live from the page.
 *
 * The diagnostics log is written through a scheduled persist, so while the main thread is busy —
 * which is precisely the state worth inspecting — nothing reaches storage and the log says the code
 * never ran. This is the same debug seam `__localEngineDebug` is: one plain object, updated at each
 * stage boundary, that a HIL run can read at any moment without waiting for anything.
 */
const searchStage: { stage: string; query: string; sinceMs: number } = { stage: "idle", query: "", sinceMs: 0 };

const markSearchStage = (stage: string, query: string) => {
  searchStage.stage = stage;
  searchStage.query = query;
  searchStage.sinceMs = Date.now();
};

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__hvscSearchStage = () => ({
    ...searchStage,
    heldForMs: searchStage.sinceMs ? Date.now() - searchStage.sinceMs : 0,
  });
}

export const searchHvscSongs = async (options: {
  query: string;
  path?: string;
  offset?: number;
  limit?: number;
}): Promise<ReturnType<typeof hvscIndex.searchSongs>> => {
  // Timed by stage, because "the search is slow" has three completely different causes and only one
  // of them is the search: waiting for the songlengths, materialising the browse index, and the scan
  // itself. Two of the three are paid once per launch and the third is paid per keystroke, so a
  // single total cannot tell anyone which one to go and fix.
  const songlengthsAt = performance.now();
  markSearchStage("songlengths", options.query);
  await ensureHvscSonglengthsReadyOnColdStart();
  const snapshotAt = performance.now();
  markSearchStage("browse-index", options.query);
  const snapshot = await hvscIndex.loadBrowseSnapshot();
  const scanAt = performance.now();
  markSearchStage("scan", options.query);
  const page = snapshot ? hvscIndex.searchSongs(options) : null;
  markSearchStage("done", options.query);
  addLog("info", "HVSC search timing", {
    query: options.query,
    songlengthsMs: Math.round(snapshotAt - songlengthsAt),
    snapshotMs: Math.round(scanAt - snapshotAt),
    scanMs: Math.round(performance.now() - scanAt),
    totalMs: Math.round(performance.now() - songlengthsAt),
    results: page?.songs.length ?? null,
    matched: page?.totalSongs ?? null,
  });
  return page;
};

/**
 * Fast synchronous bulk listing of all songs under a folder.
 * Reads directly from the in-memory browse index — no async I/O,
 * no per-page smoke snapshots. Returns null if the index is not loaded.
 *
 * Bypasses `ensureHvscIndexReady()` intentionally: the integrity check
 * there stat-probes virtual paths that may not exist on disk (songs live
 * in native SQLite, not as individual files). When the probe fails it
 * destructively clears the browse snapshot, causing `querySongsRecursive`
 * to return null and the adapter to fall back to a minutes-long paged BFS.
 * The browse page recovers via `queryFolderPage`'s inline rebuild, but
 * the recursive query path has no such rebuild —- so we load the snapshot
 * directly and, if still missing, rebuild from native without the stat check.
 */
/**
 * Every tune's length inside one SID file, in seconds, indexed by `songNr - 1`.
 *
 * A SID is a small album and its tunes are wildly different lengths — a nineteen-tune file routinely
 * holds a five-minute piece and a one-second jingle. The songlength store answers per file, so it
 * cannot say how long tune twelve is; the browse index carries the whole array, which is what this
 * reads. Empty when the archive does not know, which the caller must treat as "leave it unresolved"
 * rather than as zero.
 */
export const getHvscSubsongDurationsSeconds = async (virtualPath: string): Promise<number[]> => {
  await ensureHvscSonglengthsReadyOnColdStart();
  const snapshot = await hvscIndex.loadBrowseSnapshot();
  if (!snapshot) return [];
  const song = getHvscSongFromBrowseIndex(snapshot, virtualPath);
  return song?.durationsSeconds ? [...song.durationsSeconds] : [];
};

/**
 * What STIL calls each tune in a file, indexed by `songNr - 1`.
 *
 * Empty for the majority of the archive, which STIL does not describe, and sparse even where it
 * does: an entry may name tunes 1 and 3 and say nothing about 2. Callers treat a missing title as
 * "this tune has no name of its own", never as an error.
 */
export const getHvscSubsongTitles = async (virtualPath: string, tuneCount: number): Promise<string[]> => {
  if (tuneCount <= 0) return [];
  const entry = await getStilEntry(virtualPath);
  if (!entry) return [];
  const titles: string[] = [];
  for (let songNr = 1; songNr <= tuneCount; songNr += 1) {
    // Only the tune's own block. Falling back to the file's title here would stamp the same name on
    // every row and undo the thing this exists to fix.
    const title = primaryCredit(entry.subsongs?.[songNr])?.title ?? "";
    // The section start time is noise on a playlist row for the same reason it is on the card.
    titles.push(stripSectionTimestamp(title));
  }
  return titles;
};

export const getHvscSongsRecursive = async (
  path: string,
): Promise<ReturnType<typeof hvscIndex.querySongsRecursive>> => {
  await ensureHvscSonglengthsReadyOnColdStart();
  const snapshot = await hvscIndex.loadBrowseSnapshot();
  if (!snapshot) return null;
  return hvscIndex.querySongsRecursive(path);
};

export const streamHvscSongsRecursive = async (
  path: string,
  options: {
    chunkSize?: number;
    onChunk: (songs: NonNullable<ReturnType<typeof hvscIndex.querySongsRecursive>>) => Promise<void> | void;
  },
) => {
  await ensureHvscSonglengthsReadyOnColdStart();
  const snapshot = await hvscIndex.loadBrowseSnapshot();
  if (!snapshot) return null;
  return hvscIndex.streamSongsRecursive(path, options);
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
