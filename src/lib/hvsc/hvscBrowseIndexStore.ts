/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import type { MediaEntry } from '@/lib/media-index';
import { addLog } from '@/lib/logging';
import type { HvscSidMetadata, HvscTrackSubsong } from './hvscTypes';
import { resolveLibraryPath } from './hvscFilesystem';

const STORAGE_PATH = 'hvsc/index/hvsc-browse-index-v1.json';
const STORAGE_KEY = 'c64u_hvsc_browse_index:v1';
const MEDIA_INDEX_STORAGE_PATH = 'hvsc/index/media-index-v2.json';
const MEDIA_INDEX_STORAGE_KEY = 'c64u_media_index:v1';
const SCHEMA_VERSION = 1;

export type HvscBrowseIndexedSong = {
  virtualPath: string;
  fileName: string;
  durationSeconds?: number | null;
  sidMetadata?: HvscSidMetadata | null;
  trackSubsongs?: HvscTrackSubsong[] | null;
};

export type HvscBrowseFolderRow = {
  path: string;
  folders: string[];
  songs: string[];
};

export type HvscBrowseIndexSnapshot = {
  schemaVersion: number;
  updatedAt: string;
  songs: Record<string, HvscBrowseIndexedSong>;
  folders: Record<string, HvscBrowseFolderRow>;
};

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const normalizeFolderPath = (path: string) => {
  const normalized = normalizePath(path || '/');
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized;
};

const encodeUtf8Base64 = (value: string) => {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(value, 'utf-8').toString('base64');
};

const decodeUtf8Base64 = (value: string) => {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return value;
  }
};

const hashPath = (value: string) => Math.abs(
  Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0),
);

const getParentFolder = (virtualPath: string) => {
  const normalized = normalizePath(virtualPath);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '/';
  return normalized.substring(0, index);
};

const getFileName = (virtualPath: string) => {
  const normalized = normalizePath(virtualPath);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.substring(index + 1) : normalized;
};

const toIndexedSong = (entry: MediaEntry): HvscBrowseIndexedSong => ({
  virtualPath: normalizePath(entry.path),
  fileName: entry.name,
  durationSeconds: entry.durationSeconds ?? null,
  sidMetadata: null,
  trackSubsongs: null,
});

const buildFoldersFromSongs = (songs: Record<string, HvscBrowseIndexedSong>) => {
  const folderMap = new Map<string, { folders: Set<string>; songs: Set<string> }>();
  const ensureFolder = (path: string) => {
    const normalized = normalizeFolderPath(path);
    const current = folderMap.get(normalized);
    if (current) return current;
    const next = { folders: new Set<string>(), songs: new Set<string>() };
    folderMap.set(normalized, next);
    return next;
  };

  ensureFolder('/');
  Object.values(songs).forEach((song) => {
    const normalizedSongPath = normalizePath(song.virtualPath);
    const segments = normalizedSongPath.split('/').filter(Boolean);
    let currentPath = '/';
    for (let index = 0; index < segments.length - 1; index += 1) {
      const folderName = segments[index];
      const parent = ensureFolder(currentPath);
      const nextPath = normalizeFolderPath(`${currentPath === '/' ? '' : currentPath}/${folderName}`);
      parent.folders.add(nextPath);
      ensureFolder(nextPath);
      currentPath = nextPath;
    }
    ensureFolder(currentPath).songs.add(normalizedSongPath);
  });

  const folders: Record<string, HvscBrowseFolderRow> = {};
  folderMap.forEach((value, path) => {
    folders[path] = {
      path,
      folders: Array.from(value.folders).sort((a, b) => a.localeCompare(b)),
      songs: Array.from(value.songs).sort((a, b) => a.localeCompare(b)),
    };
  });

  return folders;
};

export const createEmptyHvscBrowseIndexSnapshot = (): HvscBrowseIndexSnapshot => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  songs: {},
  folders: {
    '/': {
      path: '/',
      folders: [],
      songs: [],
    },
  },
});

const normalizeSnapshot = (snapshot: HvscBrowseIndexSnapshot | null) => {
  if (!snapshot) return createEmptyHvscBrowseIndexSnapshot();
  if (snapshot.schemaVersion !== SCHEMA_VERSION) return null;
  const songs: Record<string, HvscBrowseIndexedSong> = {};
  Object.entries(snapshot.songs ?? {}).forEach(([path, song]) => {
    const normalizedPath = normalizePath(path);
    songs[normalizedPath] = {
      virtualPath: normalizedPath,
      fileName: song.fileName || getFileName(normalizedPath),
      durationSeconds: song.durationSeconds ?? null,
      sidMetadata: song.sidMetadata ?? null,
      trackSubsongs: song.trackSubsongs ?? null,
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: snapshot.updatedAt,
    songs,
    folders: buildFoldersFromSongs(songs),
  } satisfies HvscBrowseIndexSnapshot;
};

const parseSnapshot = (raw: string | null) => {
  if (!raw) return null;
  try {
    return normalizeSnapshot(JSON.parse(raw) as HvscBrowseIndexSnapshot);
  } catch {
    return null;
  }
};

const readFilesystemSnapshot = async () => {
  try {
    const result = await Filesystem.readFile({ directory: Directory.Data, path: STORAGE_PATH });
    return parseSnapshot(decodeUtf8Base64(result.data));
  } catch {
    return null;
  }
};

const writeFilesystemSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  await Filesystem.mkdir({ directory: Directory.Data, path: 'hvsc/index', recursive: true });
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify(snapshot)),
    recursive: true,
  });
};

const writeFilesystemMediaIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  const entries = Object.values(snapshot.songs).map((song) => ({
    path: song.virtualPath,
    name: song.fileName,
    type: 'sid' as const,
    durationSeconds: song.durationSeconds ?? null,
  }));
  await Filesystem.mkdir({ directory: Directory.Data, path: 'hvsc/index', recursive: true });
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: MEDIA_INDEX_STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify({
      version: 1,
      updatedAt: snapshot.updatedAt,
      entries,
    })),
    recursive: true,
  });
};

const readLocalStorageSnapshot = () => {
  if (typeof localStorage === 'undefined') return null;
  return parseSnapshot(localStorage.getItem(STORAGE_KEY));
};

const writeLocalStorageSnapshot = (snapshot: HvscBrowseIndexSnapshot) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

const writeLocalStorageMediaIndexSnapshot = (snapshot: HvscBrowseIndexSnapshot) => {
  if (typeof localStorage === 'undefined') return;
  const entries = Object.values(snapshot.songs).map((song) => ({
    path: song.virtualPath,
    name: song.fileName,
    type: 'sid' as const,
    durationSeconds: song.durationSeconds ?? null,
  }));
  localStorage.setItem(MEDIA_INDEX_STORAGE_KEY, JSON.stringify({
    version: 1,
    updatedAt: snapshot.updatedAt,
    entries,
  }));
};

export const loadHvscBrowseIndexSnapshot = async () => {
  if (typeof window !== 'undefined') {
    const filesystemSnapshot = await readFilesystemSnapshot();
    if (filesystemSnapshot) return filesystemSnapshot;
    return readLocalStorageSnapshot();
  }
  return readLocalStorageSnapshot();
};

export const saveHvscBrowseIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  const normalized: HvscBrowseIndexSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs: snapshot.songs,
    folders: buildFoldersFromSongs(snapshot.songs),
  };
  if (typeof window !== 'undefined') {
    try {
      await writeFilesystemSnapshot(normalized);
      await writeFilesystemMediaIndexSnapshot(normalized);
      return;
    } catch {
      writeLocalStorageSnapshot(normalized);
      writeLocalStorageMediaIndexSnapshot(normalized);
      return;
    }
  }
  writeLocalStorageSnapshot(normalized);
  writeLocalStorageMediaIndexSnapshot(normalized);
};

export const buildHvscBrowseIndexFromEntries = (entries: MediaEntry[]): HvscBrowseIndexSnapshot => {
  const songs = Object.fromEntries(entries.map((entry) => {
    const song = toIndexedSong(entry);
    return [song.virtualPath, song];
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs,
    folders: buildFoldersFromSongs(songs),
  };
};

export const createHvscBrowseIndexMutable = async (mode: 'baseline' | 'update') => {
  const snapshot = mode === 'baseline'
    ? createEmptyHvscBrowseIndexSnapshot()
    : (await loadHvscBrowseIndexSnapshot()) ?? createEmptyHvscBrowseIndexSnapshot();

  return {
    upsertSong: (song: HvscBrowseIndexedSong) => {
      const normalizedPath = normalizePath(song.virtualPath);
      snapshot.songs[normalizedPath] = {
        virtualPath: normalizedPath,
        fileName: song.fileName || getFileName(normalizedPath),
        durationSeconds: song.durationSeconds ?? null,
        sidMetadata: song.sidMetadata ?? null,
        trackSubsongs: song.trackSubsongs ?? null,
      };
    },
    deleteSong: (virtualPath: string) => {
      delete snapshot.songs[normalizePath(virtualPath)];
    },
    finalize: async () => {
      snapshot.updatedAt = new Date().toISOString();
      snapshot.folders = buildFoldersFromSongs(snapshot.songs);
      await saveHvscBrowseIndexSnapshot(snapshot);
    },
  };
};

export const listFolderFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
  query: string,
  offset: number,
  limit: number,
) => {
  const normalizedPath = normalizeFolderPath(folderPath);
  const normalizedQuery = query.trim().toLowerCase();
  const row = snapshot.folders[normalizedPath] ?? { path: normalizedPath, folders: [], songs: [] };

  const folders = Object.keys(snapshot.folders)
    .filter((folder) => folder !== '/')
    .filter((folder) => normalizedQuery.length === 0 || folder.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b));

  const matchedSongs = row.songs
    .map((path) => snapshot.songs[path])
    .filter((song): song is HvscBrowseIndexedSong => Boolean(song))
    .filter((song) => {
      if (normalizedQuery.length === 0) return true;
      return song.fileName.toLowerCase().includes(normalizedQuery)
        || song.virtualPath.toLowerCase().includes(normalizedQuery)
        || (song.sidMetadata?.name ?? '').toLowerCase().includes(normalizedQuery)
        || (song.sidMetadata?.author ?? '').toLowerCase().includes(normalizedQuery)
        || (song.sidMetadata?.released ?? '').toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    path: normalizedPath,
    folders,
    songs: matchedSongs.slice(offset, offset + limit).map((song) => ({
      id: hashPath(song.virtualPath),
      virtualPath: song.virtualPath,
      fileName: song.fileName,
      durationSeconds: song.durationSeconds ?? null,
      sidMetadata: song.sidMetadata ?? null,
      trackSubsongs: song.trackSubsongs ?? null,
    })),
    totalFolders: folders.length,
    totalSongs: matchedSongs.length,
    offset,
    limit,
    query: normalizedQuery,
  };
};

export const verifyHvscBrowseIndexIntegrity = async (snapshot: HvscBrowseIndexSnapshot, sampleSize = 12) => {
  const paths = Object.keys(snapshot.songs);
  if (!paths.length) {
    return {
      isValid: true,
      sampled: 0,
      missingPaths: [] as string[],
    };
  }
  const sampled = Math.min(sampleSize, paths.length);
  const offsetSeed = Math.floor(Date.now() / 1000) % paths.length;
  const missingPaths: string[] = [];
  for (let index = 0; index < sampled; index += 1) {
    const path = paths[(offsetSeed + index) % paths.length];
    const filePath = resolveLibraryPath(path);
    try {
      await Filesystem.stat({ directory: Directory.Data, path: filePath });
    } catch {
      missingPaths.push(path);
    }
  }

  if (missingPaths.length > 0) {
    addLog('warn', 'HVSC browse index integrity check failed', {
      sampled,
      missingCount: missingPaths.length,
      missingPaths: missingPaths.slice(0, 10),
    });
  }

  return {
    isValid: missingPaths.length === 0,
    sampled,
    missingPaths,
  };
};

export const getHvscSongFromBrowseIndex = (snapshot: HvscBrowseIndexSnapshot, virtualPath: string) => {
  return snapshot.songs[normalizePath(virtualPath)] ?? null;
};

export const getHvscFoldersWithParent = (snapshot: HvscBrowseIndexSnapshot, parentPath: string) => {
  const normalizedParent = normalizeFolderPath(parentPath);
  const row = snapshot.folders[normalizedParent];
  if (!row) return [] as Array<{ folderPath: string; folderName: string }>;
  return row.folders.map((folderPath) => ({
    folderPath,
    folderName: folderPath.split('/').pop() ?? folderPath,
  }));
};

export const listHvscFolderTracks = (snapshot: HvscBrowseIndexSnapshot, folderPath: string) => {
  const normalizedPath = normalizeFolderPath(folderPath);
  const row = snapshot.folders[normalizedPath];
  if (!row) return [] as Array<{ trackId: string; fileName: string }>;
  return row.songs.map((virtualPath) => ({
    trackId: virtualPath,
    fileName: getFileName(virtualPath),
  }));
};
