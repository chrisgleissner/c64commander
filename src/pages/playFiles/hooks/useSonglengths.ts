import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { parseSonglengths } from '@/lib/sid/songlengths';
import {
  collectSonglengthsSearchPaths,
  DOCUMENTS_FOLDER,
  isSonglengthsFileName,
} from '@/lib/sid/songlengthsDiscovery';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { getLocalFilePath, normalizeLocalPath } from '@/pages/playFiles/playFilesUtils';
import type { PlaylistItem } from '@/pages/playFiles/types';

export type SonglengthsFileEntry = { path: string; file: LocalPlayFile };

export type UseSonglengthsParams = {
  playlist: PlaylistItem[];
};

export type UseSonglengthsResult = {
  songlengthsFiles: SonglengthsFileEntry[];
  activeSonglengthsPath: string | null;
  handleSonglengthsInput: (files: FileList | null) => void;
  loadSonglengthsForPath: (
    path: string,
    extraFiles?: SonglengthsFileEntry[],
  ) => Promise<{ md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null>;
  applySonglengthsToItems: (
    items: PlaylistItem[],
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => Promise<PlaylistItem[]>;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[]) => void;
  collectSonglengthsCandidates: (paths: string[]) => string[];
};

export const useSonglengths = ({ playlist }: UseSonglengthsParams): UseSonglengthsResult => {
  const [songlengthsFiles, setSonglengthsFiles] = useState<SonglengthsFileEntry[]>([]);
  const songlengthsCacheRef = useRef(
    new Map<string, {
      signature: string;
      promise: Promise<{ md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null>;
    }>(),
  );
  const songlengthsFileCacheRef = useRef(
    new Map<string, {
      mtime: number;
      data: { md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null;
    }>(),
  );

  useEffect(() => {
    songlengthsCacheRef.current.clear();
  }, [playlist, songlengthsFiles]);

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
    songlengthsFiles.forEach((entry) => addSonglengthsFile(entry.file, entry.path));
    return map;
  }, [playlist, songlengthsFiles]);

  const activeSonglengthsPath = songlengthsFiles[0]?.path ?? null;

  const readLocalText = useCallback(async (file: LocalPlayFile) => {
    if (file instanceof File && typeof file.text === 'function') {
      return file.text();
    }
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }, []);

  const loadSonglengthsForPath = useCallback(async (
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
    if (!files.size) return null;

    const signature = Array.from(files.values())
      .map((file) => `${getLocalFilePath(file)}:${typeof file.lastModified === 'number' ? file.lastModified : 0}`)
      .sort()
      .join('|');
    const cached = songlengthsCacheRef.current.get(cacheKey);
    if (cached && cached.signature === signature) {
      return cached.promise;
    }

    const loader = (async () => {
      const merged = { md5ToSeconds: new Map<string, number>(), pathToSeconds: new Map<string, number>() };
      const ordered = Array.from(files.values()).reverse();
      for (const file of ordered) {
        try {
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          const cachedEntry = songlengthsFileCacheRef.current.get(filePath);
          if (cachedEntry && cachedEntry.mtime === mtime && cachedEntry.data) {
            cachedEntry.data.pathToSeconds.forEach((value, key) => merged.pathToSeconds.set(key, value));
            cachedEntry.data.md5ToSeconds.forEach((value, key) => merged.md5ToSeconds.set(key, value));
            continue;
          }
          const content = await readLocalText(file);
          const parsed = parseSonglengths(content);
          songlengthsFileCacheRef.current.set(filePath, { mtime, data: parsed });
          parsed.pathToSeconds.forEach((value, key) => merged.pathToSeconds.set(key, value));
          parsed.md5ToSeconds.forEach((value, key) => merged.md5ToSeconds.set(key, value));
        } catch {
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          songlengthsFileCacheRef.current.set(filePath, { mtime, data: null });
        }
      }
      return merged;
    })();

    songlengthsCacheRef.current.set(cacheKey, { signature, promise: loader });
    return loader;
  }, [readLocalText, songlengthsFilesByDir]);

  const handleSonglengthsInput = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!isSonglengthsFileName(file.name)) {
      toast({ title: 'Unsupported file', description: 'Choose a .txt or .md5 songlengths file.' });
      return;
    }
    const path = normalizeSourcePath(getLocalFilePath(file));
    setSonglengthsFiles([{ path, file }]);
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

  const applySonglengthsToItems = useCallback(async (
    items: PlaylistItem[],
    songlengthsOverrides?: SonglengthsFileEntry[],
  ) => {
    const updated = await Promise.all(
      items.map(async (item) => {
        if (item.category !== 'sid' || item.request.source !== 'local' || !item.request.file) return item;
        const filePath = getLocalFilePath(item.request.file);
        const songlengths = await loadSonglengthsForPath(filePath, songlengthsOverrides);
        const seconds = songlengths?.pathToSeconds.get(filePath);
        if (seconds === undefined || seconds === null) return item;
        return { ...item, durationMs: seconds * 1000 };
      }),
    );
    return updated;
  }, [loadSonglengthsForPath]);

  const collectSonglengthsCandidates = useCallback((paths: string[]) => {
    return collectSonglengthsSearchPaths(paths);
  }, []);

  return {
    songlengthsFiles,
    activeSonglengthsPath,
    handleSonglengthsInput,
    loadSonglengthsForPath,
    applySonglengthsToItems,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
  };
};
