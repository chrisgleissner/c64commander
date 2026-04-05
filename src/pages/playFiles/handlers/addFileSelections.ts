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
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { addLog } from "@/lib/logging";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import { reportUserError } from "@/lib/uiErrors";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from "@/lib/playback/fileLibraryUtils";
import { getPlayCategory } from "@/lib/playback/fileTypes";
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

export type AddFileSelectionsDeps = {
  addItemsStartedAtRef: MutableRefObject<number | null>;
  addItemsOverlayActiveRef: MutableRefObject<boolean>;
  addItemsOverlayStartedAtRef: MutableRefObject<number | null>;
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
    buildPlaylistItem,
    applySonglengthsToItems,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
    buildHvscLocalPlayFile,
    archiveConfigs,
  } = deps;

  const parseArchiveSelectionPath = (path: string) => {
    const [resultId, rawCategory] = path.split("/");
    const category = Number(rawCategory);
    if (!resultId || Number.isNaN(category)) {
      throw new Error(`Invalid archive selection: ${path}`);
    }
    return { resultId, category };
  };

  const hasResolvedSelectionMetadata = (selection: SelectedItem) =>
    selection.durationMs !== undefined ||
    selection.songNr !== undefined ||
    selection.subsongCount !== undefined ||
    selection.sizeBytes != null ||
    typeof selection.modifiedAt === "string";

  const PLAYLIST_APPEND_BATCH_SIZE = 250;

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

  return async (source: SourceLocation, selections: SelectedItem[]) => {
    const startedAt = Date.now();
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    let processed = 0;
    let lastUpdate = 0;

    const updateProgress = (delta: number) => {
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
        if (!onDiscoveredFiles) return;
        if (!pendingBatch.length || (!force && pendingBatch.length < PLAYLIST_APPEND_BATCH_SIZE)) return;
        const batch = pendingBatch;
        pendingBatch = [];
        await onDiscoveredFiles(batch);
      };

      const processPath = async (path: string) => {
        if (!path || visited.has(path)) return;
        visited.add(path);
        const entries = await source.listEntries(path);
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
        while (queue.length && pending.size < maxConcurrent) {
          const nextPath = queue.shift();
          if (!nextPath) continue;
          const job = processPath(nextPath).finally(() => pending.delete(job));
          pending.add(job);
        }
        if (pending.size) {
          await Promise.race(pending);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      await flushDiscoveredFiles(true);
      return files;
    };

    try {
      if (source.type === "commoserve") {
        if (!selections.length) {
          reportUserError({
            operation: "PLAYLIST_ADD",
            title: "No items selected",
            description: "Choose at least one archive result to add.",
            context: { sourceId: source.id, sourceType: source.type },
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
          await measureAddBatch(
            source.type,
            batch.length,
            async () => {
              const resolvedItems = await applySonglengthsToItems(batch);
              appendedArchiveItems += resolvedItems.length;
              setPlaylist((prev) => [...prev, ...resolvedItems]);
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
        toast({
          title: "Items added",
          description: `${appendedArchiveItems} archive result(s) added to playlist.`,
        });
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "done",
          count: appendedArchiveItems,
          message: "Added to playlist",
        }));
        await new Promise((resolve) => setTimeout(resolve, 150));
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
      const prefetchedConfigEntriesByPath = new Map<string, SourceEntry[]>();
      const getPrefetchedConfigEntriesByPath = () => {
        selectedFilesByParent.forEach((_, path) => {
          const normalizedPath = normalizeSourcePath(path);
          prefetchedConfigEntriesByPath.set(normalizedPath, getDirectoryEntries(path));
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
        await measureAddBatch(
          source.type,
          batch.length,
          async () => {
            const resolvedItems = await applySonglengthsToItems(batch, discoveredSonglengths, {
              allowMd5Fallback: false,
            });
            appendedPlaylistItems += resolvedItems.length;
            setPlaylist((prev) => [...prev, ...resolvedItems]);
            await new Promise((resolve) => setTimeout(resolve, 0));
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
        registerSelectedFile(file);
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
        const hvscFile = source.type === "hvsc" ? buildHvscLocalPlayFile(normalizedPath, file.name) : undefined;
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
          file: hvscFile ?? localFile,
          sizeBytes: file.sizeBytes ?? localEntry?.sizeBytes ?? null,
          modifiedAt: file.modifiedAt ?? localEntry?.modifiedAt ?? null,
        };
        const item = buildPlaylistItem(playable);
        if (!item) return;
        pendingPlaylistBatch.push(item);
        discoveredPlayableItems += 1;
        if (pendingPlaylistBatch.length >= PLAYLIST_APPEND_BATCH_SIZE) {
          const batch = pendingPlaylistBatch;
          pendingPlaylistBatch = [];
          await appendPlaylistBatch(batch);
        }
      };

      const recursiveSonglengthsEntries: SourceEntry[] = [];
      for (const selection of selections) {
        if (selection.type === "dir") {
          if (recurseFolders) {
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
              const nested = await source.listFilesRecursive(selection.path);
              selectedFiles.push(...nested);
              updateProgress(nested.length);
            }
          } else {
            const entries = await source.listEntries(selection.path);
            const files = entries.filter((entry) => entry.type === "file");
            listingCache.set(selection.path, entries);
            files.forEach(registerSelectedFile);
            selectedFiles.push(...files);
            updateProgress(files.length);
          }
        } else {
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

      if (source.type === "local") {
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
        const resolveSonglengthsFile = (entryPath: string, entryName: string, modifiedAt?: string | null) => {
          const normalizedPath = normalizeSourcePath(entryPath);
          const lastModified = parseModifiedAt(modifiedAt);
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
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
            addSonglengthsEntry(entry.path, file);
          });

        if (recurseFolders) {
          // Songlengths entries were already tracked during streaming recursive traversal;
          // register any that the selectedFiles scan above missed (e.g. different path casing).
          for (const entry of recursiveSonglengthsEntries) {
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
            addSonglengthsEntry(entry.path, file);
          }
        } else {
          const directorySelections = selections.filter((selection) => selection.type === "dir");
          for (const selection of directorySelections) {
            try {
              const recursiveEntries = await source.listFilesRecursive(selection.path);
              recursiveEntries
                .filter((entry) => entry.type === "file" && isSonglengthsFileName(entry.name))
                .forEach((entry) => {
                  const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
                  addSonglengthsEntry(entry.path, file);
                });
            } catch (error) {
              addLog("warn", "Failed to recursively list files for songlengths discovery.", {
                sourceId: source.id,
                selectionPath: selection.path,
                error: (error as Error).message,
              });
            }
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
                const entries = await source.listEntries(folder);
                const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt),
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
              const file = resolveSonglengthsFile(resolved.path, resolved.meta.name, resolved.meta.modifiedAt);
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
                const entries = await source.listEntries(folder);
                const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt),
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
      while (selectedFiles.length > 0) {
        const chunk = selectedFiles.splice(0, PLAYLIST_APPEND_BATCH_SIZE);
        for (const file of chunk) {
          await appendPlayableFile(file);
        }
      }

      if (pendingPlaylistBatch.length) {
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
      toast({
        title: "Items added",
        description: `${appendedPlaylistItems} file(s) added to playlist.`,
      });
      void recordSmokeBenchmarkSnapshot({
        scenario: "playlist-add",
        state: "complete",
        metadata: {
          sourceId: source.id,
          sourceType: source.type,
          selectionCount: selections.length,
          playableCount: appendedPlaylistItems,
          elapsedMs: Date.now() - startedAt,
        },
      });
      setAddItemsProgress((prev) => ({
        ...prev,
        status: "done",
        message: "Added to playlist",
      }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    } catch (error) {
      const err = error as Error;
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
      return false;
    } finally {
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
      }
    }
  };
};
