throw new Error('Deprecated legacy HVSC module. Do not import.');

import { Directory, Filesystem } from '@capacitor/filesystem';
import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import SparkMD5 from 'spark-md5';
import { addErrorLog } from '@/lib/logging';

const HVSC_ARCHIVE_URL = 'https://hvsc.brona.dk/HVSC/HVSC_84-all-of-them.7z';
const HVSC_UPDATE_URL = 'https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z';
const HVSC_META_KEY = 'c64u_hvsc_meta';
const HVSC_INDEX_PATH = 'hvsc/hvsc-index.json';
const HVSC_ROOT = 'hvsc/HVSC';
const HVSC_ARCHIVE_PATH = 'hvsc/hvsc.7z';
const HVSC_UPDATE_PATH = 'hvsc/hvsc-update.7z';
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;

export const isHvscExtractionSupported = () => {
  const capacitor = (window as Window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
};

type HvscExtractorProgressEvent = {
  percent?: number;
  processed?: number;
  total?: number;
};

type HvscExtractorPlugin = {
  extract: (options: { archivePath: string; targetPath: string; password?: string }) => Promise<void>;
  addListener: (
    eventName: 'extractProgress',
    listenerFunc: (event: HvscExtractorProgressEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

const HvscExtractor = registerPlugin<HvscExtractorPlugin>('HvscExtractor');

const describeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: (error as { cause?: unknown }).cause,
    };
  }
  return { message: String(error) };
};

const base64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const uint8ToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToString = (base64: string) => new TextDecoder().decode(base64ToUint8(base64));
const stringToBase64 = (value: string) => uint8ToBase64(new TextEncoder().encode(value));

export type HvscMeta = {
  lastCheckedAt?: string;
  lastDownloadedAt?: string;
  archiveEtag?: string | null;
  updateEtag?: string | null;
  archiveLastModified?: string | null;
  updateLastModified?: string | null;
  versionLabel?: string | null;
};

export type HvscIndex = {
  generatedAt: string;
  rootPath: string;
  totalTracks: number;
  folderPaths: string[];
  trackPaths: string[];
  pathToLengthMs: Record<string, number>;
  md5ToLengthMs: Record<string, number>;
};

export const getHvscMeta = (): HvscMeta => {
  const raw = localStorage.getItem(HVSC_META_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HvscMeta;
  } catch {
    return {};
  }
};

export const setHvscMeta = (meta: HvscMeta) => {
  localStorage.setItem(HVSC_META_KEY, JSON.stringify(meta));
};

const ensureHvscDir = async () => {
  try {
    await Filesystem.mkdir({ directory: Directory.Data, path: 'hvsc', recursive: true });
  } catch {
    // directory exists
  }
};

const headRequest = async (url: string) => {
  const isNative = isHvscExtractionSupported();
  try {
    if (isNative) {
      const response = await CapacitorHttp.request({
        url,
        method: 'HEAD',
      });
      if (response.status < 200 || response.status >= 300) {
        const error = new Error(`Failed to check ${url}: ${response.status}`);
        addErrorLog('HVSC HEAD request failed', {
          url,
          status: response.status,
          headers: response.headers,
          source: 'capacitor',
        });
        throw error;
      }
      const headers = Object.fromEntries(
        Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
      );
      return {
        etag: headers['etag'] ?? null,
        lastModified: headers['last-modified'] ?? null,
      };
    }

    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      const error = new Error(`Failed to check ${url}: ${response.status}`);
      addErrorLog('HVSC HEAD request failed', {
        url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        source: 'fetch',
      });
      throw error;
    }
    return {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } catch (error) {
    addErrorLog('HVSC HEAD request error', {
      url,
      online: navigator.onLine,
      isNative,
      source: isNative ? 'capacitor' : 'fetch',
      error: describeError(error),
    });
    throw error;
  }
};

export const checkHvscUpdate = async () => {
  const meta = getHvscMeta();
  const lastCheckedAt = meta.lastCheckedAt ? new Date(meta.lastCheckedAt) : null;
  const now = new Date();
  if (lastCheckedAt && now.getTime() - lastCheckedAt.getTime() < CHECK_THROTTLE_MS) {
    return { throttled: true, meta };
  }

  let archiveHead: { etag: string | null; lastModified: string | null };
  let updateHead: { etag: string | null; lastModified: string | null };
  try {
    [archiveHead, updateHead] = await Promise.all([
      headRequest(HVSC_ARCHIVE_URL),
      headRequest(HVSC_UPDATE_URL),
    ]);
  } catch (error) {
    addErrorLog('HVSC update check failed', {
      online: navigator.onLine,
      isNative: isHvscExtractionSupported(),
      error: describeError(error),
    });
    throw error;
  }

  const nextMeta: HvscMeta = {
    ...meta,
    lastCheckedAt: now.toISOString(),
    archiveEtag: archiveHead.etag,
    archiveLastModified: archiveHead.lastModified,
    updateEtag: updateHead.etag,
    updateLastModified: updateHead.lastModified,
  };

  const archiveChanged =
    !!archiveHead.etag && archiveHead.etag !== meta.archiveEtag ||
    !!archiveHead.lastModified && archiveHead.lastModified !== meta.archiveLastModified;
  const updateChanged =
    !!updateHead.etag && updateHead.etag !== meta.updateEtag ||
    !!updateHead.lastModified && updateHead.lastModified !== meta.updateLastModified;

  setHvscMeta(nextMeta);

  return {
    throttled: false,
    meta: nextMeta,
    archiveChanged,
    updateChanged,
  };
};

export const downloadHvscArchive = async (useUpdate = false, onProgress?: (percent: number) => void) => {
  await ensureHvscDir();
  const url = useUpdate ? HVSC_UPDATE_URL : HVSC_ARCHIVE_URL;
  const path = useUpdate ? HVSC_UPDATE_PATH : HVSC_ARCHIVE_PATH;
  try {
    const download = await Filesystem.downloadFile({
      url,
      directory: Directory.Data,
      path,
      progress: (progress) => {
        if (!onProgress || !progress || !progress.total) return;
        const percent = Math.round((progress.loaded / progress.total) * 100);
        onProgress(percent);
      },
    });

    return download.path || path;
  } catch (error) {
    addErrorLog('HVSC download failed', {
      url,
      path,
      online: navigator.onLine,
      isNative: isHvscExtractionSupported(),
      error: describeError(error),
    });
    throw error;
  }
};

export const extractHvscArchive = async (
  archivePath: string,
  onProgress?: (percent: number) => void,
) => {
  await ensureHvscDir();
  const listener = onProgress
    ? await HvscExtractor.addListener('extractProgress', (event) => {
      if (typeof event.percent === 'number') {
        onProgress(event.percent);
      }
    })
    : null;
  try {
    await HvscExtractor.extract({
      archivePath,
      targetPath: HVSC_ROOT,
    });
  } catch (error) {
    addErrorLog('HVSC extraction failed', {
      archivePath,
      error: describeError(error),
    });
    throw error;
  } finally {
    if (listener) {
      await listener.remove();
    }
  }
};

const parseSonglengths = (content: string) => {
  const pathToLengthMs: Record<string, number> = {};
  const md5ToLengthMs: Record<string, number> = {};

  let currentPath = '';
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      const path = line.replace(/^;\s*/, '').trim();
      if (path) currentPath = path;
      continue;
    }
    if (line.startsWith('[')) continue;
    const [md5, time] = line.split('=');
    if (!md5 || !time) continue;
    const [minPart, rest] = time.split(':');
    const [secPart, fracPart] = (rest || '').split('.');
    const minutes = Number(minPart);
    const seconds = Number(secPart);
    const fraction = Number(`0.${fracPart ?? '0'}`);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
    const totalMs = Math.round((minutes * 60 + seconds + fraction) * 1000);
    if (currentPath) {
      pathToLengthMs[currentPath] = totalMs;
    }
    md5ToLengthMs[md5.trim()] = totalMs;
  }

  return { pathToLengthMs, md5ToLengthMs };
};

const extractFolderList = (paths: string[]) => {
  const folders = new Set<string>();
  paths.forEach((path) => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      folders.add(current);
    }
  });
  return Array.from(folders).sort();
};

export const buildHvscIndex = async () => {
  const songlengthsPath = `${HVSC_ROOT}/C64Music/DOCUMENTS/Songlengths.md`;
  let songlengths: string;
  try {
    const songlengthsFile = await Filesystem.readFile({
      directory: Directory.Data,
      path: songlengthsPath,
    });
    songlengths = base64ToString(songlengthsFile.data);
  } catch (error) {
    addErrorLog('HVSC songlengths read failed', {
      songlengthsPath,
      error: describeError(error),
    });
    throw error;
  }
  const { pathToLengthMs, md5ToLengthMs } = parseSonglengths(songlengths);
  const trackPaths = Object.keys(pathToLengthMs).sort();
  const folderPaths = extractFolderList(trackPaths);

  const index: HvscIndex = {
    generatedAt: new Date().toISOString(),
    rootPath: HVSC_ROOT,
    totalTracks: trackPaths.length,
    folderPaths,
    trackPaths,
    pathToLengthMs,
    md5ToLengthMs,
  };

  await Filesystem.writeFile({
    directory: Directory.Data,
    path: HVSC_INDEX_PATH,
    data: stringToBase64(JSON.stringify(index)),
  });

  return index;
};

export const loadHvscIndex = async (): Promise<HvscIndex | null> => {
  try {
    const file = await Filesystem.readFile({ directory: Directory.Data, path: HVSC_INDEX_PATH });
    const json = base64ToString(file.data);
    return JSON.parse(json) as HvscIndex;
  } catch {
    return null;
  }
};

export const readHvscSidFile = async (relativePath: string) => {
  const fullPath = `${HVSC_ROOT}${relativePath}`;
  try {
    const file = await Filesystem.readFile({ directory: Directory.Data, path: fullPath });
    return base64ToUint8(file.data);
  } catch (error) {
    addErrorLog('HVSC SID read failed', { fullPath, error: describeError(error) });
    throw error;
  }
};

export const computeSidMd5 = async (data: ArrayBuffer) => {
  const md5 = SparkMD5.ArrayBuffer.hash(data);
  return md5;
};

export const createSslPayload = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.min(99, Math.floor(totalSeconds / 60));
  const seconds = Math.min(59, totalSeconds % 60);
  const bcd = (value: number) => ((Math.floor(value / 10) & 0xf) << 4) | (value % 10);
  return new Uint8Array([bcd(minutes), bcd(seconds)]);
};

export const resolveDurationMs = async (
  fileBuffer: ArrayBuffer,
  index: HvscIndex | null,
  hvscPath?: string,
) => {
  if (index && hvscPath && index.pathToLengthMs[hvscPath]) {
    return index.pathToLengthMs[hvscPath];
  }
  if (!index) return undefined;
  const md5 = await computeSidMd5(fileBuffer);
  return index.md5ToLengthMs[md5];
};
