/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import {
  countSonglengthsEntries,
} from '@/lib/sid/songlengths';
import {
  InMemoryTextBackend,
  SongLengthServiceFacade,
  type InMemorySongLengthSnapshot,
} from '@/lib/songlengths';
import {
  collectSonglengthsSearchPaths,
  DOCUMENTS_FOLDER,
  isSonglengthsFileName,
} from '@/lib/sid/songlengthsDiscovery';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { getLocalFilePath, normalizeLocalPath } from '@/pages/playFiles/playFilesUtils';
import type { PlaylistItem } from '@/pages/playFiles/types';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';

export type SonglengthsFileEntry = {
  path: string;
  file: LocalPlayFile;
  uri?: string | null;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  scope?: 'global' | 'path';
};

export type SonglengthsSummary = {
  fileName: string | null;
  path: string | null;
  sizeLabel: string | null;
  entryCount: number | null;
  error: string | null;
};

type PersistedSonglengthsFile = {
  path: string;
  uri: string;
  name: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type UseSonglengthsParams = {
  playlist: PlaylistItem[];
};

export type UseSonglengthsResult = {
  songlengthsFiles: SonglengthsFileEntry[];
  activeSonglengthsPath: string | null;
  songlengthsSummary: SonglengthsSummary;
  handleSonglengthsInput: (files: FileList | null) => void;
  handleSonglengthsPicked: (file: PersistedSonglengthsFile) => void;
  loadSonglengthsForPath: (
    path: string,
    extraFiles?: SonglengthsFileEntry[],
  ) => Promise<{ md5ToSeconds: Map<string, number[]>; pathToSeconds: Map<string, number[]> } | null>;
  applySonglengthsToItems: (
    items: PlaylistItem[],
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => Promise<PlaylistItem[]>;
  resolveSonglengthDurationMsForPath: (
    path: string,
    file?: LocalPlayFile | null,
    songNr?: number | null,
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => Promise<number | null>;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[]) => void;
  collectSonglengthsCandidates: (paths: string[]) => string[];
};

type SonglengthsResolverBundle = {
  service: SongLengthServiceFacade;
  snapshot: InMemorySongLengthSnapshot;
};

export const useSonglengths = ({ playlist }: UseSonglengthsParams): UseSonglengthsResult => {
  const [songlengthsFiles, setSonglengthsFiles] = useState<SonglengthsFileEntry[]>([]);
  const [songlengthsSummary, setSonglengthsSummary] = useState<SonglengthsSummary>({
    fileName: null,
    path: null,
    sizeLabel: null,
    entryCount: null,
    error: null,
  });
  const songlengthsCacheRef = useRef(
    new Map<string, {
      signature: string;
      promise: Promise<SonglengthsResolverBundle | null>;
    }>(),
  );
  const songlengthsFileCacheRef = useRef(
    new Map<string, {
      mtime: number;
      content: string | null;
    }>(),
  );

  const isAndroid = getPlatform() === 'android' && isNativePlatform();
  const persistedKey = 'c64u_songlengths_file:v1';

  const formatKiB = useCallback((bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || bytes <= 0) return null;
    const kib = bytes / 1024;
    const rounded = kib >= 10 ? kib.toFixed(0) : kib.toFixed(1);
    return `${rounded} KiB`;
  }, []);

  useEffect(() => {
    songlengthsCacheRef.current.clear();
  }, [playlist, songlengthsFiles]);

  useEffect(() => {
    if (!isAndroid || typeof localStorage === 'undefined') return;
    if (songlengthsFiles.length) return;
    const raw = localStorage.getItem(persistedKey);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as PersistedSonglengthsFile;
      if (!stored?.uri || !stored?.name || !stored?.path) return;
      const file = buildLocalPlayFileFromUri(stored.name, stored.path, stored.uri);
      setSonglengthsFiles([
        {
          path: stored.path,
          file,
          uri: stored.uri,
          name: stored.name,
          sizeBytes: stored.sizeBytes ?? null,
          modifiedAt: stored.modifiedAt ?? null,
        },
      ]);
    } catch (error) {
      addErrorLog('Songlengths persisted selection load failed', {
        error: (error as Error).message,
      });
    }
  }, [isAndroid, songlengthsFiles.length]);

  const songlengthsFilesByDir = useMemo(() => {
    const map = new Map<string, LocalPlayFile>();
    const addSonglengthsFile = (file: LocalPlayFile, pathOverride?: string) => {
      const path = pathOverride ?? getLocalFilePath(file);
      const folder = path.slice(0, path.lastIndexOf('/') + 1) || '/';
      const existing = map.get(folder);
      if (existing) {
        const existingPath = getLocalFilePath(existing).toLowerCase();
        const nextPath = path.toLowerCase();
        const existingIsMd5 = existingPath.endsWith('.md5');
        const nextIsMd5 = nextPath.endsWith('.md5');
        if (existingIsMd5 && !nextIsMd5) return;
        if (!existingIsMd5 && nextIsMd5) {
          map.set(folder, file);
          return;
        }
      }
      map.set(folder, file);
    };
    playlist.forEach((item) => {
      if (item.request.source !== 'local' || !item.request.file) return;
      if (!isSonglengthsFileName(item.label)) return;
      addSonglengthsFile(item.request.file);
    });
    songlengthsFiles
      .filter((entry) => entry.scope !== 'global')
      .forEach((entry) => addSonglengthsFile(entry.file, entry.path));
    return map;
  }, [playlist, songlengthsFiles]);

  const globalSonglengthsFiles = useMemo(() => (
    songlengthsFiles
      .filter((entry) => entry.scope === 'global')
      .map((entry) => entry.file)
  ), [songlengthsFiles]);

  const activeSonglengthsPath = songlengthsFiles[0]?.path ?? null;

  const readLocalText = useCallback(async (file: LocalPlayFile) => {
    if (file instanceof File && typeof file.text === 'function') {
      return file.text();
    }
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }, []);

  const summarizeSonglengthsFile = useCallback(async (entry: SonglengthsFileEntry | null) => {
    if (!entry) {
      setSonglengthsSummary({
        fileName: null,
        path: null,
        sizeLabel: null,
        entryCount: null,
        error: null,
      });
      return;
    }
    const fileName = entry.name ?? entry.file.name ?? entry.path.split('/').pop() ?? entry.path;
    const path = entry.path;
    try {
      const buffer = await entry.file.arrayBuffer();
      const sizeBytes = entry.file instanceof File
        ? entry.file.size
        : entry.sizeBytes ?? buffer.byteLength;
      const text = new TextDecoder().decode(new Uint8Array(buffer));
      const backend = new InMemoryTextBackend();
      const service = new SongLengthServiceFacade(backend, { serviceId: 'play-songlengths-summary' });
      await service.loadOnColdStart(path, async () => [{ path, content: text }], 'play-songlengths');
      const entryCount = countSonglengthsEntries(backend.exportSnapshot());
      if (!entryCount) {
        setSonglengthsSummary({
          fileName,
          path,
          sizeLabel: formatKiB(sizeBytes),
          entryCount: 0,
          error: 'Songlengths file contains no entries.',
        });
        return;
      }
      setSonglengthsSummary({
        fileName,
        path,
        sizeLabel: formatKiB(sizeBytes),
        entryCount,
        error: null,
      });
    } catch (error) {
      setSonglengthsSummary({
        fileName,
        path,
        sizeLabel: null,
        entryCount: null,
        error: (error as Error).message || 'Songlengths file could not be read.',
      });
    }
  }, [formatKiB]);

  useEffect(() => {
    void summarizeSonglengthsFile(songlengthsFiles[0] ?? null);
  }, [songlengthsFiles, summarizeSonglengthsFile]);

  const loadSonglengthBundleForPath = useCallback(async (
    path: string,
    extraFiles?: SonglengthsFileEntry[],
  ) => {
    const normalized = normalizeLocalPath(path || '/');
    const folderPath = normalized.endsWith('/') ? normalized : `${normalized.slice(0, normalized.lastIndexOf('/') + 1)}`;
    const cacheKey = folderPath || '/';
    const filesByDir = extraFiles?.length
      ? extraFiles.reduce((map, entry) => {
        const normalizedPath = normalizeSourcePath(entry.path);
        const folder = normalizedPath.slice(0, normalizedPath.lastIndexOf('/') + 1) || '/';
        map.set(folder, entry.file);
        return map;
      }, new Map(songlengthsFilesByDir))
      : songlengthsFilesByDir;
    const files = new Map<string, LocalPlayFile>();
    let current = cacheKey;
    while (current) {
      const candidate = filesByDir.get(current);
      if (candidate) files.set(getLocalFilePath(candidate), candidate);
      const docsCandidate = filesByDir.get(`${current}${DOCUMENTS_FOLDER}/`);
      if (docsCandidate) files.set(getLocalFilePath(docsCandidate), docsCandidate);
      if (current === '/') break;
      current = getParentPath(current);
    }
    const globalFiles = globalSonglengthsFiles.filter((file) => !files.has(getLocalFilePath(file)));
    if (!files.size && globalFiles.length === 0) return null;

    const signature = [...Array.from(files.values()), ...globalFiles]
      .map((file) => `${getLocalFilePath(file)}:${typeof file.lastModified === 'number' ? file.lastModified : 0}`)
      .sort()
      .join('|');
    const cached = songlengthsCacheRef.current.get(cacheKey);
    if (cached && cached.signature === signature) {
      return cached.promise;
    }

    const loader = (async () => {
      const ordered = [...Array.from(files.values()).reverse(), ...globalFiles];
      const sourceFiles: Array<{ path: string; content: string }> = [];
      for (const file of ordered) {
        try {
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          const cachedEntry = songlengthsFileCacheRef.current.get(filePath);
          if (cachedEntry && cachedEntry.mtime === mtime && cachedEntry.content !== null) {
            sourceFiles.push({ path: filePath, content: cachedEntry.content });
            continue;
          }
          const content = await readLocalText(file);
          songlengthsFileCacheRef.current.set(filePath, { mtime, content });
          sourceFiles.push({ path: filePath, content });
        } catch (error) {
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          songlengthsFileCacheRef.current.set(filePath, { mtime, content: null });
          addErrorLog('Failed to read or parse songlengths file', {
            filePath,
            mtime,
            error: (error as Error).message,
          });
        }
      }
      if (!sourceFiles.length) {
        const backend = new InMemoryTextBackend();
        const service = new SongLengthServiceFacade(backend, { serviceId: 'play-songlengths' });
        return { service, snapshot: backend.exportSnapshot() };
      }

      const backend = new InMemoryTextBackend({
        onRejectedLine: ({ sourceFile, line, raw, reason }) => {
          addErrorLog('Songlengths line rejected', {
            sourceFile,
            line,
            raw,
            reason,
          });
        },
        onAmbiguous: ({ fileName, partialPath, candidateCount, candidates }) => {
          addErrorLog('Songlengths ambiguity detected', {
            fileName,
            partialPath,
            candidateCount,
            candidates,
          });
        },
      });
      const service = new SongLengthServiceFacade(backend, { serviceId: 'play-songlengths' });
      const stats = await service.loadOnColdStart(cacheKey, async () => sourceFiles, 'play-songlengths');
      if (stats.status !== 'ready') return null;
      return { service, snapshot: backend.exportSnapshot() };
    })();

    songlengthsCacheRef.current.set(cacheKey, { signature, promise: loader });
    return loader;
  }, [readLocalText, songlengthsFilesByDir]);

  const loadSonglengthsForPath = useCallback(async (
    path: string,
    extraFiles?: SonglengthsFileEntry[],
  ) => {
    const bundle = await loadSonglengthBundleForPath(path, extraFiles);
    return bundle?.snapshot ?? null;
  }, [loadSonglengthBundleForPath]);

  const handleSonglengthsInput = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!isSonglengthsFileName(file.name)) {
      toast({ title: 'Unsupported file', description: 'Choose a .txt or .md5 songlengths file.' });
      return;
    }
    const path = normalizeSourcePath(getLocalFilePath(file));
    setSonglengthsFiles([{ path, file, name: file.name, sizeBytes: file.size, scope: 'global' }]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(persistedKey);
    }
  }, []);

  const handleSonglengthsPicked = useCallback((picked: PersistedSonglengthsFile) => {
    if (!picked?.uri || !picked?.name) return;
    if (!isSonglengthsFileName(picked.name)) {
      toast({ title: 'Unsupported file', description: 'Choose a .txt or .md5 songlengths file.' });
      return;
    }
    const path = normalizeSourcePath(picked.path || `/${picked.name}`);
    const file = buildLocalPlayFileFromUri(picked.name, path, picked.uri);
    setSonglengthsFiles([
      {
        path,
        file,
        uri: picked.uri,
        name: picked.name,
        sizeBytes: picked.sizeBytes ?? null,
        modifiedAt: picked.modifiedAt ?? null,
        scope: 'global',
      },
    ]);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(persistedKey, JSON.stringify({
        path,
        uri: picked.uri,
        name: picked.name,
        sizeBytes: picked.sizeBytes ?? null,
        modifiedAt: picked.modifiedAt ?? null,
      }));
    }
  }, []);

  const mergeSonglengthsFiles = useCallback((entries: SonglengthsFileEntry[]) => {
    setSonglengthsFiles((prev) => {
      const seen = new Set(prev.map((entry) => entry.path));
      const next = [...prev];
      entries.forEach((entry) => {
        if (seen.has(entry.path)) return;
        seen.add(entry.path);
        next.push(entry);
      });
      return next;
    });
  }, []);

  const resolveDurationMsWithFacade = useCallback(async (
    service: SongLengthServiceFacade,
    path: string,
    file?: LocalPlayFile | null,
    songNr?: number | null,
  ) => {
    const normalizedPath = normalizeLocalPath(path || '/');
    const fileName = normalizedPath.split('/').pop() ?? null;
    const resolvedByPath = service.resolveDurationSeconds({
      virtualPath: normalizedPath,
      fileName,
      songNr: songNr ?? null,
    });
    if (resolvedByPath.durationSeconds !== null) {
      return resolvedByPath.durationSeconds * 1000;
    }
    if (!file) return null;
    try {
      const buffer = await file.arrayBuffer();
      const { computeSidMd5 } = await import('@/lib/sid/sidUtils');
      const md5 = await computeSidMd5(buffer);
      const resolvedByMd5 = service.resolveDurationSeconds({
        virtualPath: normalizedPath,
        fileName,
        md5,
        songNr: songNr ?? null,
      });
      return resolvedByMd5.durationSeconds !== null ? resolvedByMd5.durationSeconds * 1000 : null;
    } catch (error) {
      addErrorLog('Failed to resolve songlength via facade md5 fallback', {
        path: normalizedPath,
        songNr: songNr ?? null,
        error: (error as Error).message,
      });
      return null;
    }
  }, []);

  const applySonglengthsToItems = useCallback(async (
    items: PlaylistItem[],
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => {
    const updated = await Promise.all(
      items.map(async (item) => {
        if (item.category !== 'sid') return item;
        const isLocal = item.request.source === 'local';
        const filePath = isLocal && item.request.file
          ? getLocalFilePath(item.request.file)
          : normalizeLocalPath(item.request.path);
        const bundle = await loadSonglengthBundleForPath(filePath, songlengthsOverrides);
        if (!bundle) return item;
        const resolvedDurationMs = await resolveDurationMsWithFacade(
          bundle.service,
          filePath,
          isLocal ? item.request.file : null,
          item.request.songNr ?? null,
        );
        if (resolvedDurationMs === null) return item;
        return { ...item, durationMs: resolvedDurationMs };
      }),
    );
    return updated;
  }, [loadSonglengthBundleForPath, resolveDurationMsWithFacade]);

  const resolveSonglengthDurationMsForPath = useCallback(async (
    path: string,
    file?: LocalPlayFile | null,
    songNr?: number | null,
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => {
    const bundle = await loadSonglengthBundleForPath(path, songlengthsOverrides);
    if (!bundle) return null;
    return resolveDurationMsWithFacade(bundle.service, path, file ?? null, songNr ?? null);
  }, [loadSonglengthBundleForPath, resolveDurationMsWithFacade]);

  const collectSonglengthsCandidates = useCallback((paths: string[]) => {
    return collectSonglengthsSearchPaths(paths);
  }, []);

  return {
    songlengthsFiles,
    activeSonglengthsPath,
    songlengthsSummary,
    handleSonglengthsInput,
    handleSonglengthsPicked,
    loadSonglengthsForPath,
    applySonglengthsToItems,
    resolveSonglengthDurationMsForPath,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
  };
};
