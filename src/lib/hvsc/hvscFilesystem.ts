import { Filesystem, Directory } from '@capacitor/filesystem';
import { parseSonglengths, type SonglengthsData } from '@/lib/sid/songlengths';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import type { HvscFolderListing, HvscSong } from './hvscTypes';
import { base64ToUint8 } from '@/lib/sid/sidUtils';

const HVSC_WORK_DIR = 'hvsc';
const HVSC_LIBRARY_DIR = `${HVSC_WORK_DIR}/library`;
const HVSC_CACHE_DIR = `${HVSC_WORK_DIR}/cache`;

const normalizeFilePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const uint8ToBase64 = (data: Uint8Array) => {
  let binary = '';
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const decodeBase64Text = (raw: string) => {
  try {
    const bytes = base64ToUint8(raw);
    return new TextDecoder().decode(bytes);
  } catch {
    return raw;
  }
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message?: string }).message ?? '';
    }
    if ('error' in error && typeof (error as { error?: unknown }).error === 'string') {
      return (error as { error?: string }).error ?? '';
    }
    if ('error' in error && (error as { error?: unknown }).error && typeof (error as { error?: any }).error === 'object') {
      const nested = (error as { error?: { message?: unknown } }).error;
      if (nested && typeof nested.message === 'string') return nested.message;
    }
  }
  return String(error ?? '');
};

const isExistsError = (error: unknown) =>
  /exists|already exists/i.test(getErrorMessage(error));

const encodeText = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return uint8ToBase64(bytes);
};

const statPath = async (path: string) => {
  try {
    return await Filesystem.stat({ directory: Directory.Data, path });
  } catch {
    return null;
  }
};

const writeFileWithRetry = async (path: string, data: string) => {
  try {
    await Filesystem.writeFile({ directory: Directory.Data, path, data });
    return;
  } catch (error) {
    if (!isExistsError(error)) throw error;
    const existing = await statPath(path);
    if (existing?.type === 'file') return;
    try {
      await Filesystem.rmdir({ directory: Directory.Data, path, recursive: true });
    } catch {
      // ignore
    }
    try {
      await Filesystem.deleteFile({ directory: Directory.Data, path });
    } catch {
      // ignore
    }
    try {
      await Filesystem.writeFile({ directory: Directory.Data, path, data });
    } catch (retryError) {
      if (isExistsError(retryError)) {
        const retryExisting = await statPath(path);
        if (retryExisting?.type === 'file') return;
      }
      throw retryError;
    }
  }
};

const ensureDir = async (path: string) => {
  const existing = await statPath(path);
  if (existing?.type === 'directory') return;
  if (existing?.type === 'file') {
    try {
      await Filesystem.deleteFile({ directory: Directory.Data, path });
    } catch {
      // ignore
    }
  }
  try {
    await Filesystem.mkdir({ directory: Directory.Data, path, recursive: true });
  } catch (error) {
    if (!isExistsError(error)) throw error;
  }
};

export const ensureHvscDirs = async () => {
  await ensureDir(HVSC_LIBRARY_DIR);
  await ensureDir(HVSC_CACHE_DIR);
};

export const getHvscCacheDir = () => HVSC_CACHE_DIR;
export const getHvscLibraryDir = () => HVSC_LIBRARY_DIR;

export const resolveLibraryPath = (virtualPath: string) => {
  const normalized = normalizeFilePath(virtualPath);
  const relative = normalized.replace(/^\//, '');
  return relative ? `${HVSC_LIBRARY_DIR}/${relative}` : HVSC_LIBRARY_DIR;
};

const resolveLibraryFolder = (path: string) => {
  const normalized = normalizeSourcePath(path || '/');
  const relative = normalized.replace(/^\//, '');
  return relative ? `${HVSC_LIBRARY_DIR}/${relative}` : HVSC_LIBRARY_DIR;
};

const listEntries = async (path: string) => {
  try {
    const result = await Filesystem.readdir({ directory: Directory.Data, path });
    return result.files ?? [];
  } catch {
    return [];
  }
};

const resolveEntry = async (basePath: string, entry: string | { name?: string; type?: 'file' | 'directory' }) => {
  if (typeof entry === 'string') {
    const stat = await Filesystem.stat({ directory: Directory.Data, path: `${basePath}/${entry}` });
    return { name: entry, type: stat.type };
  }
  const name = entry.name ?? '';
  if (!entry.type && name) {
    const stat = await Filesystem.stat({ directory: Directory.Data, path: `${basePath}/${name}` });
    return { name, type: stat.type };
  }
  return { name, type: entry.type };
};

let songlengthsCache: SonglengthsData | null = null;

const loadSonglengths = async (): Promise<SonglengthsData | null> => {
  if (songlengthsCache) return songlengthsCache;
  const md5Path = `${HVSC_LIBRARY_DIR}/Songlengths.md5`;
  const txtPath = `${HVSC_LIBRARY_DIR}/Songlengths.txt`;
  let parsed: SonglengthsData | null = null;
  try {
    const md5 = await Filesystem.readFile({ directory: Directory.Data, path: md5Path });
    parsed = parseSonglengths(decodeBase64Text(md5.data));
  } catch {
    parsed = null;
  }
  try {
    const txt = await Filesystem.readFile({ directory: Directory.Data, path: txtPath });
    const parsedTxt = parseSonglengths(decodeBase64Text(txt.data));
    if (parsed) {
      parsedTxt.pathToSeconds.forEach((value, key) => {
        if (!parsed?.pathToSeconds.has(key)) parsed?.pathToSeconds.set(key, value);
      });
      parsedTxt.md5ToSeconds.forEach((value, key) => {
        if (!parsed?.md5ToSeconds.has(key)) parsed?.md5ToSeconds.set(key, value);
      });
    } else {
      parsed = parsedTxt;
    }
  } catch {
    // ignore missing text file
  }
  songlengthsCache = parsed;
  return songlengthsCache;
};

export const resetSonglengthsCache = () => {
  songlengthsCache = null;
};

export const listHvscFolder = async (path: string): Promise<HvscFolderListing> => {
  const normalized = normalizeSourcePath(path || '/');
  const basePath = resolveLibraryFolder(normalized);
  const entries = await listEntries(basePath);
  const folders: string[] = [];
  const songs: HvscFolderListing['songs'] = [];
  const durations = await loadSonglengths();

  for (const entry of entries) {
    const resolved = await resolveEntry(basePath, entry);
    if (!resolved.name) continue;
    if (resolved.type === 'directory') {
      folders.push(`${normalized === '/' ? '' : normalized}/${resolved.name}`.replace(/\/+/g, '/'));
    } else if (resolved.type === 'file' && resolved.name.toLowerCase().endsWith('.sid')) {
      const virtualPath = `${normalized === '/' ? '' : normalized}/${resolved.name}`.replace(/\/+/g, '/');
      songs.push({
        id: Math.abs(Array.from(virtualPath).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)),
        virtualPath,
        fileName: resolved.name,
        durationSeconds: durations?.pathToSeconds.get(normalizeFilePath(virtualPath))?.[0] ?? null,
      });
    }
  }

  return {
    path: normalized,
    folders: folders.sort((a, b) => a.localeCompare(b)),
    songs: songs.sort((a, b) => a.fileName.localeCompare(b.fileName)),
  };
};

export const getHvscSongByVirtualPath = async (virtualPath: string): Promise<HvscSong | null> => {
  const path = resolveLibraryPath(virtualPath);
  try {
    const result = await Filesystem.readFile({ directory: Directory.Data, path });
    return {
      id: Math.abs(Array.from(virtualPath).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)),
      virtualPath: normalizeFilePath(virtualPath),
      fileName: virtualPath.split('/').pop() || virtualPath,
      durationSeconds: (await loadSonglengths())?.pathToSeconds.get(normalizeFilePath(virtualPath))?.[0] ?? null,
      md5: null,
      dataBase64: result.data,
    };
  } catch {
    return null;
  }
};

export const getHvscDurationByMd5 = async (md5: string) => {
  const songlengths = await loadSonglengths();
  return songlengths?.md5ToSeconds.get(md5)?.[0] ?? null;
};

export const writeLibraryFile = async (virtualPath: string, data: Uint8Array) => {
  const path = resolveLibraryPath(virtualPath);
  const parent = path.split('/').slice(0, -1).join('/');
  if (parent) {
    await ensureDir(parent);
  }
  await writeFileWithRetry(path, uint8ToBase64(data));
};

export const deleteLibraryFile = async (virtualPath: string) => {
  const path = resolveLibraryPath(virtualPath);
  await Filesystem.deleteFile({ directory: Directory.Data, path });
};

export const resetLibraryRoot = async () => {
  resetSonglengthsCache();
  try {
    await Filesystem.rmdir({ directory: Directory.Data, path: HVSC_LIBRARY_DIR, recursive: true });
  } catch {
    // ignore missing dir
  }
  await ensureDir(HVSC_LIBRARY_DIR);
};

export const readCachedArchive = async (relativePath: string) => {
  const result = await Filesystem.readFile({ directory: Directory.Data, path: `${HVSC_CACHE_DIR}/${relativePath}` });
  return base64ToUint8(result.data);
};

export const writeCachedArchive = async (relativePath: string, data: Uint8Array) => {
  await ensureDir(HVSC_CACHE_DIR);
  await writeFileWithRetry(`${HVSC_CACHE_DIR}/${relativePath}`, uint8ToBase64(data));
};

export type HvscArchiveMarker = {
  version: number;
  type: 'baseline' | 'update';
  sizeBytes?: number | null;
  completedAt: string;
};

export const getHvscCacheMarkerPath = (relativePath: string) => `${HVSC_CACHE_DIR}/${relativePath}.complete.json`;

export const writeCachedArchiveMarker = async (relativePath: string, marker: HvscArchiveMarker) => {
  await ensureDir(HVSC_CACHE_DIR);
  const payload = JSON.stringify(marker);
  await writeFileWithRetry(getHvscCacheMarkerPath(relativePath), encodeText(payload));
};

export const readCachedArchiveMarker = async (relativePath: string): Promise<HvscArchiveMarker | null> => {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: getHvscCacheMarkerPath(relativePath),
    });
    const parsed = JSON.parse(decodeBase64Text(result.data)) as HvscArchiveMarker;
    if (!parsed?.completedAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const deleteCachedArchive = async (relativePath: string) => {
  try {
    await Filesystem.deleteFile({ directory: Directory.Data, path: `${HVSC_CACHE_DIR}/${relativePath}` });
  } catch {
    try {
      await Filesystem.rmdir({ directory: Directory.Data, path: `${HVSC_CACHE_DIR}/${relativePath}`, recursive: true });
    } catch {
      // ignore
    }
  }
  try {
    await Filesystem.deleteFile({ directory: Directory.Data, path: getHvscCacheMarkerPath(relativePath) });
  } catch {
    // ignore
  }
};
