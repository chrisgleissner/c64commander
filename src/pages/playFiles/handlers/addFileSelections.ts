/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "@/hooks/use-toast";
import { createArchiveClient } from "@/lib/archive/client";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { streamHvscSongsRecursive } from "@/lib/hvsc";
import { getHvscDisplayAuthor, getHvscDisplayTitle, type HvscBrowseIndexedSong } from "@/lib/hvsc/hvscBrowseIndexStore";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { addErrorLog, addLog } from "@/lib/logging";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import { reportUserError } from "@/lib/uiErrors";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from "@/lib/playback/fileLibraryUtils";
import { getPlayCategory } from "@/lib/playback/fileTypes";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { LocalSourceListingError } from "@/lib/sourceNavigation/localSourceErrors";
import type { SelectedItem, SourceEntry, SourceLocation } from "@/lib/sourceNavigation/types";
import { redactTreeUri } from "@/lib/native/safUtils";
import type { AddItemsProgressState } from "@/components/itemSelection/AddItemsProgressOverlay";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import type { PlayableEntry, PlaylistItem } from "@/pages/playFiles/types";
import type { SonglengthsFileEntry } from "@/pages/playFiles/hooks/useSonglengths";
import type { SonglengthResolutionOptions } from "@/pages/playFiles/songlengthsResolution";
import { isSonglengthsFileName } from "@/lib/sid/songlengthsDiscovery";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import { resolvePlaybackConfig } from "@/lib/config/configResolution";
import { parseModifiedAt } from "@/pages/playFiles/playFilesUtils";
import { commitPlaylistSnapshot, markPlaylistRepositoryPhase } from "@/pages/playFiles/playlistRepositorySync";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

export type AddFileSelectionsDeps = {
  addItemsStartedAtRef: MutableRefObject<number | null>;
  addItemsOverlayActiveRef: MutableRefObject<boolean>;
  addItemsOverlayStartedAtRef: MutableRefObject<number | null>;
  addItemsAbortControllerRef?: MutableRefObject<AbortController | null>;
  addItemsSurface: "dialog" | "page";
  browserOpen: boolean;
  recurseFolders: boolean;
  songlengthsFiles: SonglengthsFileEntry[];
  localSourceTreeUris: Map<string, string | null>;
  localEntriesBySourceId: Map<
    string,
    Map<
      string,
      {
        uri?: string | null;
        name: string;
        modifiedAt?: string | null;
        sizeBytes?: number | null;
      }
    >
  >;
  setAddItemsSurface: (value: "dialog" | "page") => void;
  setShowAddItemsOverlay: (value: boolean) => void;
  setIsAddingItems: (value: boolean) => void;
  setAddItemsProgress: Dispatch<SetStateAction<AddItemsProgressState>>;
  setPlaylist: Dispatch<SetStateAction<PlaylistItem[]>>;
  playlistSnapshotRef: MutableRefObject<PlaylistItem[]>;
  playlistStorageKey: string;
  buildPlaylistItem: (
    entry: PlayableEntry,
    songNrOverride?: number,
    addedAtOverride?: string | null,
  ) => PlaylistItem | null;
  applySonglengthsToItems: (
    items: PlaylistItem[],
    songlengthsOverrides?: SonglengthsFileEntry[],
    options?: SonglengthResolutionOptions,
  ) => Promise<PlaylistItem[]>;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[]) => void;
  collectSonglengthsCandidates: (paths: string[]) => string[];
  buildHvscLocalPlayFile: (path: string, name: string) => LocalPlayFile | undefined;
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;
};

export const createAddFileSelectionsHandler = (deps: AddFileSelectionsDeps) => {
  const {
    addItemsStartedAtRef,
    addItemsOverlayActiveRef,
    addItemsOverlayStartedAtRef,
    addItemsAbortControllerRef,
    addItemsSurface,
    browserOpen,
    recurseFolders,
    songlengthsFiles,
    localSourceTreeUris,
    localEntriesBySourceId,
    setAddItemsSurface,
    setShowAddItemsOverlay,
    setIsAddingItems,
    setAddItemsProgress,
    setPlaylist,
    playlistSnapshotRef,
    playlistStorageKey,
    buildPlaylistItem,
    applySonglengthsToItems,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
    archiveConfigs,
  } = deps;

  const createAbortError = () => {
    if (typeof DOMException !== "undefined") {
      return new DOMException("Add items scan cancelled", "AbortError");
    }
    const error = new Error("Add items scan cancelled");
    error.name = "AbortError";
    return error;
  };

  const isAbortError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { message?: unknown; name?: unknown };
    return (
      candidate.name === "AbortError" ||
      (typeof candidate.message === "string" && /cancelled|aborted/i.test(candidate.message))
    );
  };

  const parseArchiveSelectionPath = (path: string) => {
    const [resultId, rawCategory] = path.split("/");
    const category = Number(rawCategory);
    if (!resultId || Number.isNaN(category)) {
      throw new Error(`Invalid archive selection: ${path}`);
    }
    return { resultId, category };
  };

  const hasMd5SonglengthsFile = (entries: SonglengthsFileEntry[] | undefined) =>
    Boolean(entries?.some((entry) => entry.path.toLowerCase().endsWith(".md5")));

  const formatSonglengthsMib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  const buildUltimateSonglengthsFile = (
    entryPath: string,
    entryName: string,
    modifiedAt?: string | null,
    sizeBytes?: number | null,
    signal?: AbortSignal,
  ): LocalPlayFile => {
    const normalizedPath = normalizeSourcePath(entryPath);
    const lastModified = parseModifiedAt(modifiedAt) ?? Date.now();
    const totalBytes = typeof sizeBytes === "number" && sizeBytes > 0 ? sizeBytes : 0;
    return {
      name: entryName,
      webkitRelativePath: normalizedPath,
      lastModified,
      arrayBuffer: async () => {
        const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
        try {
          const { data } = await readFtpFile({
            host: normalizeFtpHost(rawHost),
            port: getStoredFtpPort(),
            password,
            path: normalizedPath,
            // No idle timeout: a slow multi-MB songlengths read over the c64u's
            // single-threaded FTP must run to completion. User-cancellation (via
            // the add-flow signal) is the escape, not a short transfer timeout —
            // a timeout that truncates the transfer can wedge the firmware's FTP
            // data channel.
            timeoutMs: 0,
            totalBytes,
            signal,
            onProgress: ({ bytesRead, totalBytes: total }) => {
              const readMib = formatSonglengthsMib(bytesRead);
              const message =
                total > 0
                  ? `Reading song-length database… ${readMib} / ${formatSonglengthsMib(total)} MB`
                  : `Reading song-length database… ${readMib} MB`;
              setAddItemsProgress((prev) => ({ ...prev, message }));
            },
          });
          const bytes = base64ToUint8(data);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } finally {
          setAddItemsProgress((prev) =>
            typeof prev.message === "string" && prev.message.startsWith("Reading song-length database")
              ? { ...prev, message: "Scanning…" }
              : prev,
          );
        }
      },
    };
  };

  const hasResolvedSelectionMetadata = (selection: SelectedItem) =>
    selection.durationMs !== undefined ||
    selection.songNr !== undefined ||
    selection.subsongCount !== undefined ||
    selection.sizeBytes != null ||
    typeof selection.modifiedAt === "string";

  const PLAYLIST_APPEND_BATCH_SIZE = 250;

  // HVSC items carry durations from the browse index and need no per-item
  // config discovery or songlengths file loading.  Accumulating into one
  // batch and flushing once eliminates O(n) intermediate React re-renders
  // that caused >10 min wall time for ~4500 items on Pixel 4 class hardware.
  const HVSC_BULK_BATCH_THRESHOLD = 200_000;

  // Largest c64u (ultimate) songlengths file we will auto-read over FTP during an
  // add. The HVSC Songlengths.md5 is ~5 MiB and may grow toward 6 MiB over the
  // coming years, so we allow it through. The read itself is streamed with no idle
  // timeout, byte-progress reporting, and user-cancellation (see
  // buildUltimateSonglengthsFile) so a slow multi-MB transfer completes cleanly
  // instead of timing out and wedging the firmware's FTP data channel.
  const MAX_AUTO_ULTIMATE_SONGLENGTHS_BYTES = 6_291_456; // 6 MiB

  const measureAddBatch = async <T>(
    sourceType: SourceLocation["type"],
    batchSize: number,
    run: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ) => {
    const scope = beginHvscPerfScope("playlist:add-batch", {
      sourceType,
      batchSize,
      ...metadata,
    });
    try {
      const result = await run();
      endHvscPerfScope(scope, {
        outcome: "success",
        sourceType,
        batchSize,
        ...metadata,
      });
      return result;
    } catch (error) {
      const err = error as Error;
      endHvscPerfScope(scope, {
        outcome: "error",
        sourceType,
        batchSize,
        errorName: err.name,
        errorMessage: err.message,
        ...metadata,
      });
      throw error;
    }
  };

  const mapHvscSongToEntry = (song: HvscBrowseIndexedSong): SourceEntry => ({
    type: "file",
    name: getHvscDisplayTitle(song),
    path: normalizeSourcePath(song.virtualPath),
    subtitle: getHvscDisplayAuthor(song),
    durationMs: song.durationSeconds != null ? song.durationSeconds * 1000 : undefined,
    songNr:
      song.trackSubsongs?.find((entry) => entry.isDefault)?.songNr ??
      song.defaultSong ??
      song.sidMetadata?.startSong ??
      undefined,
    subsongCount:
      song.trackSubsongs?.length ??
      song.subsongCount ??
      song.durationsSeconds?.length ??
      song.sidMetadata?.songs ??
      undefined,
  });

  return async (source: SourceLocation, selections: SelectedItem[]) => {
    const startedAt = Date.now();
    const deferredFeedback: Array<() => void> = [];
    const dispatchFeedback = (callback: () => void) => {
      if (addItemsOverlayActiveRef.current) {
        deferredFeedback.push(callback);
        return;
      }
      callback();
    };
    addItemsStartedAtRef.current = startedAt;
    const localTreeUri = source.type === "local" ? localSourceTreeUris.get(source.id) : null;
    if (localTreeUri) {
      addLog("debug", "SAF scan started", {
        sourceId: source.id,
        treeUri: redactTreeUri(localTreeUri),
        rootPath: source.rootPath,
      });
    }
    if (!browserOpen) {
      setAddItemsSurface("page");
      if (!addItemsOverlayActiveRef.current) {
        setShowAddItemsOverlay(true);
        addItemsOverlayStartedAtRef.current = Date.now();
        addItemsOverlayActiveRef.current = true;
      }
    }
    setIsAddingItems(true);
    setAddItemsProgress({
      status: "scanning",
      count: 0,
      elapsedMs: 0,
      total: null,
      message: "Scanning…",
    });
    addItemsAbortControllerRef?.current?.abort();
    const abortController = new AbortController();
    const abortSignal = abortController.signal;
    const selectedDeviceIdAtStart = getSavedDevicesSnapshot().selectedDeviceId;
    if (addItemsAbortControllerRef) {
      addItemsAbortControllerRef.current = abortController;
    }
    const throwIfAborted = () => {
      if (abortSignal.aborted) {
        throw createAbortError();
      }
      if (getSavedDevicesSnapshot().selectedDeviceId !== selectedDeviceIdAtStart) {
        abortController.abort();
        throw createAbortError();
      }
    };
    const handleConnectionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      if (detail?.reason !== "saved-device-switch") return;
      abortController.abort();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("c64u-connection-change", handleConnectionChange as EventListener);
    }
    markPlaylistRepositoryPhase(playlistStorageKey, "SCANNING", {
      expectedCount: playlistSnapshotRef.current.length,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let processed = 0;
    let lastUpdate = 0;

    const updateProgress = (delta: number) => {
      throwIfAborted();
      processed += delta;
      const now = Date.now();
      if (now - lastUpdate < 120) return;
      lastUpdate = now;
      setAddItemsProgress((prev) => ({
        ...prev,
        count: processed,
        elapsedMs: now - startedAt,
      }));
    };

    const listingCache = new Map<string, SourceEntry[]>();

    const collectRecursive = async (rootPath: string, onDiscoveredFiles?: (files: SourceEntry[]) => Promise<void>) => {
      const queue = [rootPath];
      const visited = new Set<string>();
      const files: SourceEntry[] = [];
      let pendingBatch: SourceEntry[] = [];
      const maxConcurrent = 3;
      const pending = new Set<Promise<void>>();

      const flushDiscoveredFiles = async (force = false) => {
        throwIfAborted();
        if (!onDiscoveredFiles) return;
        if (!pendingBatch.length || (!force && pendingBatch.length < PLAYLIST_APPEND_BATCH_SIZE)) return;
        const batch = pendingBatch;
        pendingBatch = [];
        await onDiscoveredFiles(batch);
      };

      const processPath = async (path: string) => {
        throwIfAborted();
        if (!path || visited.has(path)) return;
        visited.add(path);
        const entries = await source.listEntries(path);
        throwIfAborted();
        listingCache.set(path, entries);
        entries.forEach((entry) => {
          if (entry.type === "dir") {
            queue.push(entry.path);
          } else {
            if (onDiscoveredFiles) {
              pendingBatch.push(entry);
            } else {
              files.push(entry);
            }
          }
        });
        await flushDiscoveredFiles();
        updateProgress(entries.filter((entry) => entry.type === "file").length);
      };

      while (queue.length || pending.size) {
        throwIfAborted();
        while (queue.length && pending.size < maxConcurrent) {
          const nextPath = queue.shift();
          if (!nextPath) continue;
          const job = processPath(nextPath).finally(() => pending.delete(job));
          pending.add(job);
        }
        if (pending.size) {
          await Promise.race(pending);
          throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      await flushDiscoveredFiles(true);
      return files;
    };

    try {
      if (source.type === "commoserve") {
        if (!selections.length) {
          dispatchFeedback(() => {
            reportUserError({
              operation: "PLAYLIST_ADD",
              title: "No items selected",
              description: "Choose at least one archive result to add.",
              context: { sourceId: source.id, sourceType: source.type },
            });
          });
          setAddItemsProgress((prev) => ({
            ...prev,
            status: "error",
            message: "No items selected.",
          }));
          return false;
        }
        const archiveConfig = archiveConfigs?.[source.id];
        if (!archiveConfig) {
          throw new Error(`Archive source configuration unavailable for ${source.name}.`);
        }

        const archiveClient = createArchiveClient(archiveConfig);
        let appendedArchiveItems = 0;
        let pendingArchiveBatch: PlaylistItem[] = [];

        const flushArchiveBatch = async () => {
          if (!pendingArchiveBatch.length) return;
          const batch = pendingArchiveBatch;
          pendingArchiveBatch = [];
          setAddItemsProgress((prev) => ({
            ...prev,
            status: "ingesting",
            message: "Importing playlist items…",
          }));
          markPlaylistRepositoryPhase(playlistStorageKey, "INGESTING", {
            expectedCount: playlistSnapshotRef.current.length + batch.length,
          });
          await measureAddBatch(
            source.type,
            batch.length,
            async () => {
              throwIfAborted();
              const resolvedItems = await applySonglengthsToItems(batch);
              throwIfAborted();
              appendedArchiveItems += resolvedItems.length;
              // throwIfAborted must not run inside the updater: React may invoke it
              // outside a normal try/catch (e.g. StrictMode double-invoke), where a
              // thrown AbortError propagates to the nearest error boundary instead
              // of being caught by this async function. See HARD9-033.
              //
              // The snapshot ref is mirrored INSIDE the updater (not after
              // setPlaylist returns): React does not guarantee the functional
              // updater runs synchronously at dispatch time (eager bail-out vs.
              // deferred commit), so assigning from a post-call `next` could read
              // a stale []; the next batch reads playlistSnapshotRef.current for
              // its expectedCount and would under-report. The assignment is pure
              // and idempotent (same value on a StrictMode double-invoke). See
              // HARD10 PR review.
              setPlaylist((prev) => {
                const next = [...prev, ...resolvedItems];
                playlistSnapshotRef.current = next;
                return next;
              });
              await new Promise((resolve) => setTimeout(resolve, 0));
            },
            {
              sourceId: source.id,
              selectionCount: selections.length,
            },
          );
        };

        for (const selection of selections) {
          const { resultId, category } = parseArchiveSelectionPath(selection.path);
          const entries = await archiveClient.getEntries(resultId, category);
          const playableEntry = entries.find((entry) => getPlayCategory(entry.path));
          if (!playableEntry) {
            throw new Error(`No playable archive file found for ${selection.name}.`);
          }

          const item = buildPlaylistItem(
            {
              source: "commoserve",
              name: selection.name,
              path: playableEntry.path,
              sourceId: source.id,
              archiveRef: {
                sourceId: source.id,
                resultId,
                category,
                entryId: playableEntry.id,
                entryPath: playableEntry.path,
              },
              sizeBytes: playableEntry.size ?? null,
              modifiedAt: playableEntry.date ? new Date(playableEntry.date).toISOString() : null,
            },
            undefined,
            new Date().toISOString(),
          );
          if (!item) {
            throw new Error(`Unsupported archive file ${playableEntry.path}.`);
          }
          pendingArchiveBatch.push(item);
          if (pendingArchiveBatch.length >= PLAYLIST_APPEND_BATCH_SIZE) {
            await flushArchiveBatch();
          }
        }

        await flushArchiveBatch();
        dispatchFeedback(() => {
          toast({
            title: "Items added",
            description: `${appendedArchiveItems} archive result(s) added to playlist.`,
          });
        });
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "ready",
          count: appendedArchiveItems,
          message: "Playlist ready",
        }));
        void commitPlaylistSnapshot({
          playlistId: playlistStorageKey,
          items: playlistSnapshotRef.current,
          initialPhase: "BACKGROUND_COMMITTING",
        }).catch((error) => {
          addErrorLog("Background playlist repository commit failed", {
            playlistStorageKey,
            sourceType: source.type,
            error: {
              name: (error as Error).name,
              message: (error as Error).message,
              stack: (error as Error).stack,
            },
          });
        });
        return true;
      }

      const selectedFiles: SourceEntry[] = [];
      const selectedFilesByParent = new Map<string, SourceEntry[]>();
      const registerSelectedFile = (file: SourceEntry) => {
        const parent = getParentPath(file.path);
        const existing = selectedFilesByParent.get(parent) ?? [];
        existing.push(file);
        selectedFilesByParent.set(parent, existing);
      };
      const getDirectoryEntries = (parentPath: string) => {
        const selectedEntries = selectedFilesByParent.get(parentPath) ?? [];
        const cachedEntries = listingCache.get(parentPath) ?? [];
        const merged = new Map<string, SourceEntry>();
        [...selectedEntries, ...cachedEntries].forEach((entry) => {
          if (entry.type === "file") {
            merged.set(normalizeSourcePath(entry.path), entry);
          }
        });
        return [...merged.values()];
      };
      // HARD12-015: build the per-parent prefetched entry map once per parent
      // (on first need) and cache it. Previously the map was rebuilt wholesale
      // inside every getPrefetchedConfigEntriesByPath call (one call per file
      // in the per-file loop), making the cumulative merge work quadratic in
      // the per-folder file count for single-folder batch adds. The merged
      // content is unchanged; only the rebuild cadence drops from O(calls).
      const prefetchedConfigEntriesByPath = new Map<string, SourceEntry[]>();
      const getPrefetchedConfigEntriesByPath = () => {
        selectedFilesByParent.forEach((_, path) => {
          const normalizedPath = normalizeSourcePath(path);
          if (!prefetchedConfigEntriesByPath.has(normalizedPath)) {
            prefetchedConfigEntriesByPath.set(normalizedPath, getDirectoryEntries(path));
          }
        });
        // Also include parents that came from listingCache alone (no selected
        // files), so discoverConfigCandidates can resolve sibling entries
        // without round-tripping through source.listEntries again.
        listingCache.forEach((entries, path) => {
          const normalizedPath = normalizeSourcePath(path);
          if (!prefetchedConfigEntriesByPath.has(normalizedPath)) {
            const merged = new Map<string, SourceEntry>();
            entries.forEach((entry) => {
              if (entry.type === "file") merged.set(normalizeSourcePath(entry.path), entry);
            });
            prefetchedConfigEntriesByPath.set(normalizedPath, [...merged.values()]);
          }
        });
        return prefetchedConfigEntriesByPath;
      };
      const resolveSelectionEntry = async (filePath: string) => {
        const parent = getParentPath(filePath);
        if (!listingCache.has(parent)) {
          try {
            listingCache.set(parent, await source.listEntries(parent));
          } catch (error) {
            addLog("warn", "Failed to list entries for selection lookup", {
              sourceId: source.id,
              sourceType: source.type,
              selectionPath: filePath,
              parentPath: parent,
              error: (error as Error).message,
            });
            listingCache.set(parent, []);
          }
        }
        const entries = listingCache.get(parent) ?? [];
        return (
          entries.find(
            (entry) => entry.type === "file" && normalizeSourcePath(entry.path) === normalizeSourcePath(filePath),
          ) ?? null
        );
      };
      let appendedPlaylistItems = 0;
      let discoveredPlayableItems = 0;
      let discoveredSonglengths: SonglengthsFileEntry[] | undefined;
      const appendPlaylistBatch = async (batch: PlaylistItem[]) => {
        if (!batch.length) return;
        const batchT0 = Date.now();
        addLog("debug", "[hvsc-perf] appendPlaylistBatch start", { count: batch.length });
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "ingesting",
          message: "Importing playlist items…",
        }));
        markPlaylistRepositoryPhase(playlistStorageKey, "INGESTING", {
          expectedCount: playlistSnapshotRef.current.length + batch.length,
        });
        await measureAddBatch(
          source.type,
          batch.length,
          async () => {
            const slT0 = Date.now();
            throwIfAborted();
            const resolvedItems =
              source.type === "hvsc"
                ? batch
                : await applySonglengthsToItems(batch, discoveredSonglengths, {
                    allowMd5Fallback:
                      source.type === "ultimate" &&
                      (hasMd5SonglengthsFile(songlengthsFiles) || hasMd5SonglengthsFile(discoveredSonglengths)),
                  });
            throwIfAborted();
            addLog("debug", "[hvsc-perf] applySonglengthsToItems done", {
              count: resolvedItems.length,
              ms: Date.now() - slT0,
            });
            appendedPlaylistItems += resolvedItems.length;
            const spT0 = Date.now();
            throwIfAborted();
            // throwIfAborted must not run inside the updater: React may invoke it
            // outside a normal try/catch (e.g. StrictMode double-invoke), where a
            // thrown AbortError propagates to the nearest error boundary instead
            // of being caught by this async function. See HARD9-033.
            //
            // The snapshot ref is mirrored INSIDE the updater (not after
            // setPlaylist returns): React does not guarantee the functional
            // updater runs synchronously at dispatch time, so a post-call read
            // could observe a stale []. The assignment is pure and idempotent.
            // See HARD10 PR review.
            setPlaylist((prev) => {
              const next = prev.length === 0 ? resolvedItems : [...prev, ...resolvedItems];
              playlistSnapshotRef.current = next;
              return next;
            });
            addLog("debug", "[hvsc-perf] setPlaylist done", { ms: Date.now() - spT0 });
            await new Promise((resolve) => setTimeout(resolve, 0));
            addLog("debug", "[hvsc-perf] appendPlaylistBatch done", { totalMs: Date.now() - batchT0 });
          },
          {
            sourceId: source.id,
            discoveredSonglengthCount: discoveredSonglengths?.length ?? 0,
          },
        );
      };

      let pendingPlaylistBatch: PlaylistItem[] = [];
      const appendPlayableFile = async (file: SourceEntry) => {
        if (!getPlayCategory(file.path)) return;
        if (source.type !== "hvsc") {
          registerSelectedFile(file);
        }
        const normalizedPath = normalizeSourcePath(file.path);
        const localEntry = source.type === "local" ? localEntriesBySourceId.get(source.id)?.get(normalizedPath) : null;
        const entryModified = localEntry?.modifiedAt
          ? parseModifiedAt(localEntry.modifiedAt)
          : parseModifiedAt(file.modifiedAt);
        const localFile =
          source.type === "local"
            ? resolveLocalRuntimeFile(source.id, normalizedPath) ||
              (localEntry?.uri
                ? buildLocalPlayFileFromUri(localEntry.name, normalizedPath, localEntry.uri, entryModified)
                : undefined) ||
              (localTreeUri
                ? buildLocalPlayFileFromTree(file.name, normalizedPath, localTreeUri, entryModified)
                : undefined)
            : undefined;
        const playbackConfig =
          source.type === "local" || source.type === "ultimate"
            ? resolvePlaybackConfig({
                candidates: await discoverConfigCandidates({
                  sourceType: source.type,
                  sourceId: source.type === "local" ? source.id : null,
                  sourceRootPath: source.rootPath,
                  targetFile: file,
                  listEntries: source.listEntries,
                  prefetchedEntriesByPath: getPrefetchedConfigEntriesByPath(),
                  localEntriesBySourceId,
                }),
              })
            : {
                configRef: null as ConfigFileReference | null,
                configOrigin: "none" as const,
                configCandidates: [],
                configOverrides: null,
              };
        throwIfAborted();
        const playable: PlayableEntry = {
          source: source.type === "ultimate" ? "ultimate" : source.type === "hvsc" ? "hvsc" : "local",
          name: file.name,
          path: normalizedPath,
          configRef: playbackConfig.configRef,
          configOrigin: playbackConfig.configOrigin,
          configOverrides: playbackConfig.configOverrides,
          configCandidates: playbackConfig.configCandidates,
          durationMs: file.durationMs,
          songNr: file.songNr,
          subsongCount: file.subsongCount,
          sourceId: source.type === "local" || source.type === "hvsc" ? source.id : null,
          file: localFile,
          sizeBytes: file.sizeBytes ?? localEntry?.sizeBytes ?? null,
          modifiedAt: file.modifiedAt ?? localEntry?.modifiedAt ?? null,
        };
        const item = buildPlaylistItem(playable);
        if (!item) return;
        pendingPlaylistBatch.push(item);
        discoveredPlayableItems += 1;
        const effectiveBatchSize = source.type === "hvsc" ? HVSC_BULK_BATCH_THRESHOLD : PLAYLIST_APPEND_BATCH_SIZE;
        if (pendingPlaylistBatch.length >= effectiveBatchSize) {
          const batch = pendingPlaylistBatch;
          pendingPlaylistBatch = [];
          await appendPlaylistBatch(batch);
        }
      };

      const recursiveSonglengthsEntries: SourceEntry[] = [];
      const scanT0 = Date.now();
      for (const selection of selections) {
        if (selection.type === "dir") {
          if (recurseFolders) {
            throwIfAborted();
            if (source.type === "hvsc") {
              const streamed = await streamHvscSongsRecursive(selection.path, {
                chunkSize: PLAYLIST_APPEND_BATCH_SIZE,
                onChunk: async (songs) => {
                  throwIfAborted();
                  updateProgress(songs.length);
                  for (const song of songs) {
                    throwIfAborted();
                    await appendPlayableFile(mapHvscSongToEntry(song));
                  }
                  await new Promise((resolve) => setTimeout(resolve, 0));
                  throwIfAborted();
                },
              });
              throwIfAborted();
              if (streamed) {
                continue;
              }
            }
            if (source.type === "local") {
              await collectRecursive(selection.path, async (batch) => {
                for (const file of batch) {
                  registerSelectedFile(file);
                  selectedFiles.push(file);
                  if (isSonglengthsFileName(file.name)) {
                    recursiveSonglengthsEntries.push(file);
                  }
                }
              });
            } else {
              const nested = await source.listFilesRecursive(selection.path, { signal: abortSignal });
              throwIfAborted();
              if (source.type === "hvsc") {
                while (nested.length > 0) {
                  throwIfAborted();
                  const chunk = nested.splice(0, PLAYLIST_APPEND_BATCH_SIZE);
                  updateProgress(chunk.length);
                  for (const file of chunk) {
                    await appendPlayableFile(file);
                  }
                  await new Promise((resolve) => setTimeout(resolve, 0));
                }
              } else {
                selectedFiles.push(...nested);
                updateProgress(nested.length);
              }
            }
          } else {
            throwIfAborted();
            const entries = await source.listEntries(selection.path);
            throwIfAborted();
            const files = entries.filter((entry) => entry.type === "file");
            listingCache.set(selection.path, entries);
            files.forEach(registerSelectedFile);
            selectedFiles.push(...files);
            updateProgress(files.length);
          }
        } else {
          throwIfAborted();
          const normalizedPath = normalizeSourcePath(selection.path);
          const meta = hasResolvedSelectionMetadata(selection)
            ? selection
            : await resolveSelectionEntry(normalizedPath);
          selectedFiles.push({
            type: "file",
            name: meta?.name ?? selection.name,
            path: normalizedPath,
            durationMs: meta?.durationMs,
            songNr: meta?.songNr,
            subsongCount: meta?.subsongCount,
            sizeBytes: meta?.sizeBytes ?? null,
            modifiedAt: meta?.modifiedAt ?? null,
          });
          registerSelectedFile(selectedFiles[selectedFiles.length - 1]!);
          updateProgress(1);
        }
      }

      addLog("debug", "[hvsc-perf] scan done", {
        files: selectedFiles.length,
        ms: Date.now() - scanT0,
      });

      if (source.type === "local" || source.type === "ultimate") {
        const treeUri = localSourceTreeUris.get(source.id);
        const entriesMap = localEntriesBySourceId.get(source.id);
        const knownSonglengths = new Set(songlengthsFiles.map((entry) => entry.path));
        const discovered: SonglengthsFileEntry[] = [];
        const addSonglengthsEntry = (path: string, file?: LocalPlayFile) => {
          if (!file) return;
          const normalizedPath = normalizeSourcePath(path);
          if (knownSonglengths.has(normalizedPath)) return;
          knownSonglengths.add(normalizedPath);
          discovered.push({ path: normalizedPath, file });
        };
        const resolveSonglengthsFile = (
          entryPath: string,
          entryName: string,
          modifiedAt?: string | null,
          sizeBytes?: number | null,
        ) => {
          const normalizedPath = normalizeSourcePath(entryPath);
          const lastModified = parseModifiedAt(modifiedAt);
          if (source.type === "ultimate") {
            // Auto-reading a large songlengths database (e.g. the multi-MB HVSC
            // Songlengths.md5) over the c64u's fragile single-threaded FTP
            // reliably exceeds the 8s transfer timeout and can wedge the device's
            // FTP data channel until a power-cycle. Skip the auto load for
            // oversized files; durations fall back to the default (the user can
            // still select a songlengths file manually). Small custom songlengths
            // files are unaffected.
            if (sizeBytes != null && sizeBytes > MAX_AUTO_ULTIMATE_SONGLENGTHS_BYTES) {
              addLog("info", "Skipping oversized c64u songlengths auto-load", {
                path: normalizedPath,
                sizeBytes,
                limit: MAX_AUTO_ULTIMATE_SONGLENGTHS_BYTES,
              });
              return undefined;
            }
            return buildUltimateSonglengthsFile(normalizedPath, entryName, modifiedAt, sizeBytes, abortSignal);
          }
          const entry = entriesMap?.get(normalizedPath);
          return (
            resolveLocalRuntimeFile(source.id, normalizedPath) ||
            (entry?.uri ? buildLocalPlayFileFromUri(entryName, normalizedPath, entry.uri, lastModified) : undefined) ||
            (treeUri ? buildLocalPlayFileFromTree(entryName, normalizedPath, treeUri, lastModified) : undefined)
          );
        };

        selectedFiles
          .filter((entry) => entry.type === "file" && isSonglengthsFileName(entry.name))
          .forEach((entry) => {
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt, entry.sizeBytes);
            addSonglengthsEntry(entry.path, file);
          });

        if (recurseFolders) {
          // Songlengths entries were already tracked during streaming recursive traversal;
          // register any that the selectedFiles scan above missed (e.g. different path casing).
          for (const entry of recursiveSonglengthsEntries) {
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt, entry.sizeBytes);
            addSonglengthsEntry(entry.path, file);
          }
        } else {
          // HARD12-014: when the user opted out of recursion the add itself
          // walks only one level (see listEntries branch above). The
          // songlengths discovery must respect the same scope — search the
          // already-cached direct children of every selected directory rather
          // than calling listFilesRecursive (which on a load-fragile c64u FTP
          // service can stall the whole control plane).
          const directorySelections = selections.filter((selection) => selection.type === "dir");
          for (const selection of directorySelections) {
            const directChildren = listingCache.get(selection.path) ?? [];
            directChildren
              .filter((entry) => entry.type === "file" && isSonglengthsFileName(entry.name))
              .forEach((entry) => {
                const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt, entry.sizeBytes);
                addSonglengthsEntry(entry.path, file);
              });
          }
        }

        const sidPaths = selectedFiles
          .filter((entry) => getPlayCategory(entry.path) === "sid")
          .map((entry) => entry.path);
        const candidatePaths = collectSonglengthsCandidates(sidPaths).filter((path) => !knownSonglengths.has(path));
        if (candidatePaths.length) {
          if (treeUri) {
            const foldersToScan = new Set(
              candidatePaths.map((path) => {
                const trimmed = path.replace(/\/[^/]+$/, "/");
                return normalizeSourcePath(trimmed || "/");
              }),
            );
            for (const folder of foldersToScan) {
              try {
                throwIfAborted();
                const entries = await source.listEntries(folder);
                throwIfAborted();
                const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt, songEntry.sizeBytes),
                );
              } catch (error) {
                addLog("debug", "Failed to list entries while scanning for songlengths file", {
                  folder,
                  sourceId: source.id,
                  error: (error as Error).message,
                });
              }
            }
          } else if (entriesMap) {
            // Candidate paths are generated with lowercase file names, but SAF paths are case-sensitive.
            // Use the actual entry path casing when possible.
            const entriesByLowerPath = new Map<
              string,
              {
                path: string;
                meta: {
                  uri?: string | null;
                  name: string;
                  modifiedAt?: string | null;
                  sizeBytes?: number | null;
                };
              }
            >();
            entriesMap.forEach((meta, entryPath) => {
              entriesByLowerPath.set(entryPath.toLowerCase(), {
                path: entryPath,
                meta,
              });
            });
            candidatePaths.forEach((candidate) => {
              const direct = entriesMap.get(candidate);
              const resolved = direct
                ? { path: candidate, meta: direct }
                : entriesByLowerPath.get(candidate.toLowerCase());
              if (!resolved) return;
              const file = resolveSonglengthsFile(
                resolved.path,
                resolved.meta.name,
                resolved.meta.modifiedAt,
                resolved.meta.sizeBytes,
              );
              addSonglengthsEntry(resolved.path, file);
            });
          } else {
            const foldersToScan = new Set(
              candidatePaths.map((path) => {
                const trimmed = path.replace(/\/[^/]+$/, "/");
                return normalizeSourcePath(trimmed || "/");
              }),
            );
            for (const folder of foldersToScan) {
              try {
                throwIfAborted();
                const entries = await source.listEntries(folder);
                throwIfAborted();
                const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt, songEntry.sizeBytes),
                );
              } catch (error) {
                addLog("debug", "Failed to list entries while scanning for songlengths file", {
                  folder,
                  sourceId: source.id,
                  error: (error as Error).message,
                });
              }
            }
          }
        }

        if (discovered.length) {
          discoveredSonglengths = discovered;
          mergeSonglengthsFiles(discovered);
          addLog("info", "Songlengths file(s) discovered", {
            sourceId: source.id,
            sourceType: source.type,
            count: discovered.length,
            paths: discovered.map((entry) => entry.path),
          });
        }
      }

      const buildItemsScope =
        source.type === "hvsc"
          ? beginHvscPerfScope("playlist:build-items", {
              sourceType: source.type,
              fileCount: selectedFiles.length,
            })
          : null;

      const buildT0 = Date.now();
      while (selectedFiles.length > 0) {
        throwIfAborted();
        const chunk = selectedFiles.splice(0, PLAYLIST_APPEND_BATCH_SIZE);
        for (const file of chunk) {
          throwIfAborted();
          await appendPlayableFile(file);
        }
        // Yield to the event loop so progress updates render on-screen.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      addLog("debug", "[hvsc-perf] build-items done", {
        pending: pendingPlaylistBatch.length,
        appended: appendedPlaylistItems,
        ms: Date.now() - buildT0,
      });

      if (buildItemsScope) {
        endHvscPerfScope(buildItemsScope, {
          outcome: "success",
          itemCount: pendingPlaylistBatch.length + appendedPlaylistItems,
        });
      }

      if (pendingPlaylistBatch.length) {
        throwIfAborted();
        await appendPlaylistBatch(pendingPlaylistBatch);
        pendingPlaylistBatch = [];
      }

      if (!discoveredPlayableItems) {
        const reason = selectedFiles.length === 0 ? "no-files-found" : "unsupported-files";
        addLog("debug", "No supported files after scan", {
          sourceId: source.id,
          sourceType: source.type,
          reason,
          totalFiles: selectedFiles.length,
        });
        dispatchFeedback(() => {
          reportUserError({
            operation: "PLAYLIST_ADD",
            title: "No supported files",
            description: "Found no supported files.",
            context: {
              sourceId: source.id,
              sourceType: source.type,
              totalFiles: selectedFiles.length,
            },
          });
        });
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "error",
          message: "No supported files found.",
        }));
        return false;
      }

      const minDuration = addItemsSurface === "page" ? 800 : 300;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }
      if (localTreeUri) {
        addLog("debug", "SAF scan complete", {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          totalFiles: selectedFiles.length,
          supportedFiles: appendedPlaylistItems,
          elapsedMs: Date.now() - startedAt,
        });
      }
      dispatchFeedback(() => {
        toast({
          title: "Items added",
          description: `${appendedPlaylistItems} file(s) added to playlist.`,
        });
      });
      void recordSmokeBenchmarkSnapshot({
        scenario: "playlist-add",
        state: "complete",
        metadata: {
          sourceId: source.id,
          sourceType: source.type,
          selectionCount: selections.length,
          playableCount: appendedPlaylistItems,
          playlistSize: playlistSnapshotRef.current.length,
          feedbackKind: "progress",
          feedbackVisibleWithinMs: 0,
          feedbackWithinBudget: true,
          elapsedMs: Date.now() - startedAt,
        },
      });
      addLog("debug", "[hvsc-perf] pipeline done", {
        totalMs: Date.now() - startedAt,
        items: appendedPlaylistItems,
      });
      setAddItemsProgress((prev) => ({
        ...prev,
        status: "ready",
        message: "Playlist ready",
      }));
      void commitPlaylistSnapshot({
        playlistId: playlistStorageKey,
        items: playlistSnapshotRef.current,
        initialPhase: "BACKGROUND_COMMITTING",
      }).catch((error) => {
        addErrorLog("Background playlist repository commit failed", {
          playlistStorageKey,
          sourceType: source.type,
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
      });
      return true;
    } catch (error) {
      const err = error as Error;
      if (isAbortError(err)) {
        addLog("debug", "Add items scan cancelled", {
          sourceId: source.id,
          sourceType: source.type,
          selectionCount: selections.length,
        });
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "idle",
          message: "Add cancelled",
        }));
        markPlaylistRepositoryPhase(playlistStorageKey, "IDLE", {
          expectedCount: playlistSnapshotRef.current.length,
        });
        return false;
      }
      const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
      if (localTreeUri) {
        addLog("debug", "SAF scan failed", {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          error: err.message,
        });
      }
      setAddItemsProgress((prev) => ({
        ...prev,
        status: "error",
        message: "Add items failed",
      }));
      markPlaylistRepositoryPhase(playlistStorageKey, "ERROR", {
        lastError: err.message,
      });
      dispatchFeedback(() => {
        reportUserError({
          operation: "PLAYLIST_ADD",
          title: "Add items failed",
          description: err.message,
          error: err,
          context: {
            sourceId: source.id,
            sourceType: source.type,
            details: listingDetails,
          },
        });
      });
      return false;
    } finally {
      if (typeof window !== "undefined") {
        window.removeEventListener("c64u-connection-change", handleConnectionChange as EventListener);
      }
      if (addItemsAbortControllerRef?.current === abortController) {
        addItemsAbortControllerRef.current = null;
      }
      setIsAddingItems(false);
      if (addItemsStartedAtRef.current) {
        setAddItemsProgress((prev) => ({
          ...prev,
          elapsedMs: Date.now() - addItemsStartedAtRef.current!,
        }));
      }
      if (addItemsOverlayActiveRef.current) {
        const overlayStartedAt = addItemsOverlayStartedAtRef.current ?? startedAt;
        const minOverlayDuration = 800;
        const overlayElapsed = Date.now() - overlayStartedAt;
        if (overlayElapsed < minOverlayDuration) {
          await new Promise((resolve) => setTimeout(resolve, minOverlayDuration - overlayElapsed));
        }
        setShowAddItemsOverlay(false);
        addItemsOverlayStartedAtRef.current = null;
        addItemsOverlayActiveRef.current = false;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      deferredFeedback.splice(0).forEach((callback) => callback());
    }
  };
};
