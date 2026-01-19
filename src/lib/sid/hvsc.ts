export {};
/* Deprecated legacy HVSC module. All HVSC logic moved to src/lib/hvsc.

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
  export {};
  // Legacy HVSC module removed. Use src/lib/hvsc instead.
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

*/
