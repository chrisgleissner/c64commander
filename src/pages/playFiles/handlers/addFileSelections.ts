import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { toast } from '@/hooks/use-toast';
import { addLog } from '@/lib/logging';
import { getC64APIConfigSnapshot } from '@/lib/c64api';
import { reportUserError } from '@/lib/uiErrors';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';
import { getPlayCategory } from '@/lib/playback/fileTypes';
import { resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeFtpHost } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import type { SelectedItem, SourceEntry, SourceLocation } from '@/lib/sourceNavigation/types';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { readFtpFile } from '@/lib/ftp/ftpClient';
import { redactTreeUri } from '@/lib/native/safUtils';
import type { AddItemsProgressState } from '@/components/itemSelection/AddItemsProgressOverlay';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import type { PlayableEntry, PlaylistItem } from '@/pages/playFiles/types';
import type { SonglengthsFileEntry } from '@/pages/playFiles/hooks/useSonglengths';
import { isSonglengthsFileName } from '@/lib/sid/songlengthsDiscovery';
import { parseModifiedAt } from '@/pages/playFiles/playFilesUtils';

export type AddFileSelectionsDeps = {
  addItemsStartedAtRef: MutableRefObject<number | null>;
  addItemsOverlayActiveRef: MutableRefObject<boolean>;
  addItemsOverlayStartedAtRef: MutableRefObject<number | null>;
  addItemsSurface: 'dialog' | 'page';
  browserOpen: boolean;
  recurseFolders: boolean;
  songlengthsFiles: SonglengthsFileEntry[];
  localSourceTreeUris: Map<string, string | null>;
  localEntriesBySourceId: Map<string, Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>>;
  setAddItemsSurface: (value: 'dialog' | 'page') => void;
  setShowAddItemsOverlay: (value: boolean) => void;
  setIsAddingItems: (value: boolean) => void;
  setAddItemsProgress: Dispatch<SetStateAction<AddItemsProgressState>>;
  setPlaylist: Dispatch<SetStateAction<PlaylistItem[]>>;
  buildPlaylistItem: (entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null) => PlaylistItem | null;
  applySonglengthsToItems: (items: PlaylistItem[], songlengthsOverrides?: SonglengthsFileEntry[]) => Promise<PlaylistItem[]>;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[]) => void;
  collectSonglengthsCandidates: (paths: string[]) => string[];
  buildHvscLocalPlayFile: (path: string, name: string) => LocalPlayFile | undefined;
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
  } = deps;

  return async (source: SourceLocation, selections: SelectedItem[]) => {
    const startedAt = Date.now();
    addItemsStartedAtRef.current = startedAt;
    const localTreeUri = source.type === 'local' ? localSourceTreeUris.get(source.id) : null;
    if (localTreeUri) {
      addLog('debug', 'SAF scan started', {
        sourceId: source.id,
        treeUri: redactTreeUri(localTreeUri),
        rootPath: source.rootPath,
      });
    }
    if (!browserOpen) {
      setAddItemsSurface('page');
      if (!addItemsOverlayActiveRef.current) {
        setShowAddItemsOverlay(true);
        addItemsOverlayStartedAtRef.current = Date.now();
        addItemsOverlayActiveRef.current = true;
      }
    }
    setIsAddingItems(true);
    setAddItemsProgress({ status: 'scanning', count: 0, elapsedMs: 0, total: null, message: 'Scanning…' });
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

    const collectRecursive = async (rootPath: string) => {
      const queue = [rootPath];
      const visited = new Set<string>();
      const files: SourceEntry[] = [];
      const maxConcurrent = 3;
      const pending = new Set<Promise<void>>();

      const processPath = async (path: string) => {
        if (!path || visited.has(path)) return;
        visited.add(path);
        const entries = await source.listEntries(path);
        entries.forEach((entry) => {
          if (entry.type === 'dir') {
            queue.push(entry.path);
          } else {
            files.push(entry);
          }
        });
        updateProgress(entries.filter((entry) => entry.type === 'file').length);
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
      return files;
    };

    try {
      const selectedFiles: SourceEntry[] = [];
      const listingCache = new Map<string, SourceEntry[]>();
      const resolveSelectionEntry = async (filePath: string) => {
        const parent = getParentPath(filePath);
        if (!listingCache.has(parent)) {
          try {
            listingCache.set(parent, await source.listEntries(parent));
          } catch (error) {
            addLog('warn', 'Failed to list entries for selection lookup', {
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
        return entries.find(
          (entry) => entry.type === 'file' && normalizeSourcePath(entry.path) === normalizeSourcePath(filePath),
        ) ?? null;
      };
      for (const selection of selections) {
        if (selection.type === 'dir') {
          if (recurseFolders) {
            const nested = await collectRecursive(selection.path);
            selectedFiles.push(...nested);
          } else {
            const entries = await source.listEntries(selection.path);
            const files = entries.filter((entry) => entry.type === 'file');
            selectedFiles.push(...files);
            updateProgress(files.length);
          }
        } else {
          const normalizedPath = normalizeSourcePath(selection.path);
          const meta = await resolveSelectionEntry(normalizedPath);
          selectedFiles.push({
            type: 'file',
            name: meta?.name ?? selection.name,
            path: normalizedPath,
            sizeBytes: meta?.sizeBytes ?? null,
            modifiedAt: meta?.modifiedAt ?? null,
          });
          updateProgress(1);
        }
      }

      const playlistItems: PlaylistItem[] = [];
      let discoveredSonglengths: SonglengthsFileEntry[] | undefined;
      if (source.type === 'local' || source.type === 'ultimate') {
        const isUltimateSource = source.type === 'ultimate';
        const treeUri = localSourceTreeUris.get(source.id);
        const entriesMap = localEntriesBySourceId.get(source.id);
        const knownSonglengths = new Set(songlengthsFiles.map((entry) => entry.path));
        const discovered: SonglengthsFileEntry[] = [];
        const base64ToArrayBuffer = (base64: string) => {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes.buffer;
        };
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
          if (isUltimateSource) {
            return {
              name: entryName,
              webkitRelativePath: normalizedPath,
              lastModified: lastModified ?? Date.now(),
              arrayBuffer: async () => {
                const { deviceHost, password } = getC64APIConfigSnapshot();
                const response = await readFtpFile({
                  host: normalizeFtpHost(deviceHost),
                  port: getStoredFtpPort(),
                  password: password ?? '',
                  path: normalizedPath,
                });
                return base64ToArrayBuffer(response.data);
              },
            } as LocalPlayFile;
          }
          const entry = entriesMap?.get(normalizedPath);
          return resolveLocalRuntimeFile(source.id, normalizedPath)
            || (entry?.uri
              ? buildLocalPlayFileFromUri(entryName, normalizedPath, entry.uri, lastModified)
              : undefined)
            || (treeUri
              ? buildLocalPlayFileFromTree(entryName, normalizedPath, treeUri, lastModified)
              : undefined);
        };

        selectedFiles
          .filter((entry) => entry.type === 'file' && isSonglengthsFileName(entry.name))
          .forEach((entry) => {
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
            addSonglengthsEntry(entry.path, file);
          });

        const directorySelections = selections.filter((selection) => selection.type === 'dir');
        for (const selection of directorySelections) {
          try {
            const recursiveEntries = await source.listFilesRecursive(selection.path);
            recursiveEntries
              .filter((entry) => entry.type === 'file' && isSonglengthsFileName(entry.name))
              .forEach((entry) => {
                const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
                addSonglengthsEntry(entry.path, file);
              });
          } catch (error) {
            addLog('warn', 'Failed to recursively list files for songlengths discovery.', {
              sourceId: source.id,
              selectionPath: selection.path,
              error: (error as Error).message,
            });
          }
        }

        const sidPaths = selectedFiles
          .filter((entry) => getPlayCategory(entry.path) === 'sid')
          .map((entry) => entry.path);
        const candidatePaths = collectSonglengthsCandidates(sidPaths).filter((path) => !knownSonglengths.has(path));
        if (candidatePaths.length) {
          if (treeUri) {
            const foldersToScan = new Set(candidatePaths.map((path) => {
              const trimmed = path.replace(/\/[^/]+$/, '/');
              return normalizeSourcePath(trimmed || '/');
            }));
            for (const folder of foldersToScan) {
              try {
                const entries = await source.listEntries(folder);
                const songEntry = entries.find(
                  (entry) => entry.type === 'file' && isSonglengthsFileName(entry.name),
                );
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt),
                );
              } catch (error) {
                addLog('debug', 'Failed to list entries while scanning for songlengths file', {
                  folder,
                  sourceId: source.id,
                  error: (error as Error).message,
                });
              }
            }
          } else if (entriesMap) {
            // Candidate paths are generated with lowercase file names, but SAF paths are case-sensitive.
            // Use the actual entry path casing when possible.
            const entriesByLowerPath = new Map<string, { path: string; meta: { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null } }>();
            entriesMap.forEach((meta, entryPath) => {
              entriesByLowerPath.set(entryPath.toLowerCase(), { path: entryPath, meta });
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
            const foldersToScan = new Set(candidatePaths.map((path) => {
              const trimmed = path.replace(/\/[^/]+$/, '/');
              return normalizeSourcePath(trimmed || '/');
            }));
            for (const folder of foldersToScan) {
              try {
                const entries = await source.listEntries(folder);
                const songEntry = entries.find(
                  (entry) => entry.type === 'file' && isSonglengthsFileName(entry.name),
                );
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt),
                );
              } catch (error) {
                addLog('debug', 'Failed to list entries while scanning for songlengths file', {
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
          addLog('info', 'Songlengths file(s) discovered', {
            sourceId: source.id,
            sourceType: source.type,
            count: discovered.length,
            paths: discovered.map((entry) => entry.path),
          });
        }
      }
      selectedFiles.forEach((file) => {
        if (!getPlayCategory(file.path)) return;
        const normalizedPath = normalizeSourcePath(file.path);
        const localEntry = source.type === 'local' ? localEntriesBySourceId.get(source.id)?.get(normalizedPath) : null;
        const entryModified = localEntry?.modifiedAt
          ? parseModifiedAt(localEntry.modifiedAt)
          : parseModifiedAt(file.modifiedAt);
        const localFile =
          source.type === 'local'
            ? resolveLocalRuntimeFile(source.id, normalizedPath)
              || (localEntry?.uri ? buildLocalPlayFileFromUri(localEntry.name, normalizedPath, localEntry.uri, entryModified) : undefined)
              || (localTreeUri ? buildLocalPlayFileFromTree(file.name, normalizedPath, localTreeUri, entryModified) : undefined)
            : undefined;
        const hvscFile = source.type === 'hvsc'
          ? buildHvscLocalPlayFile(normalizedPath, file.name)
          : undefined;
        const playable: PlayableEntry = {
          source: source.type === 'ultimate' ? 'ultimate' : source.type === 'hvsc' ? 'hvsc' : 'local',
          name: file.name,
          path: normalizedPath,
          durationMs: undefined,
          sourceId: source.type === 'local' || source.type === 'hvsc' ? source.id : null,
          file: hvscFile ?? localFile,
          sizeBytes: file.sizeBytes ?? localEntry?.sizeBytes ?? null,
          modifiedAt: file.modifiedAt ?? localEntry?.modifiedAt ?? null,
        };
        const item = buildPlaylistItem(playable);
        if (item) playlistItems.push(item);
      });

      if (!playlistItems.length) {
        const reason = selectedFiles.length === 0 ? 'no-files-found' : 'unsupported-files';
        addLog('debug', 'No supported files after scan', {
          sourceId: source.id,
          sourceType: source.type,
          reason,
          totalFiles: selectedFiles.length,
        });
        reportUserError({
          operation: 'PLAYLIST_ADD',
          title: 'No supported files',
          description: 'Found no supported files.',
          context: {
            sourceId: source.id,
            sourceType: source.type,
            totalFiles: selectedFiles.length,
          },
        });
        setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'No supported files found.' }));
        return false;
      }

      const minDuration = addItemsSurface === 'page' ? 800 : 300;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }
      const resolvedItems = await applySonglengthsToItems(playlistItems, discoveredSonglengths);
      setPlaylist((prev) => [...prev, ...resolvedItems]);
      if (localTreeUri) {
        addLog('debug', 'SAF scan complete', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          totalFiles: selectedFiles.length,
          supportedFiles: playlistItems.length,
          elapsedMs: Date.now() - startedAt,
        });
      }
      toast({ title: 'Items added', description: `${playlistItems.length} file(s) added to playlist.` });
      setAddItemsProgress((prev) => ({ ...prev, status: 'done', message: 'Added to playlist' }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    } catch (error) {
      const err = error as Error;
      const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
      if (localTreeUri) {
        addLog('debug', 'SAF scan failed', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          error: err.message,
        });
      }
      setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'Add items failed' }));
      reportUserError({
        operation: 'PLAYLIST_ADD',
        title: 'Add items failed',
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
