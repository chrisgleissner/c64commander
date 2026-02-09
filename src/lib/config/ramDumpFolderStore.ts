import { addErrorLog } from '@/lib/logging';

const RAM_DUMP_FOLDER_KEY = 'c64u_ram_dump_folder:v1';

export type RamDumpFolderConfig = {
  treeUri: string;
  rootName: string | null;
  selectedAt: string;
  displayPath?: string | null;
};

const isValidFolderConfig = (value: unknown): value is RamDumpFolderConfig => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.treeUri === 'string'
    && (candidate.rootName === null || typeof candidate.rootName === 'string')
    && typeof candidate.selectedAt === 'string'
    && (candidate.displayPath === undefined
      || candidate.displayPath === null
      || typeof candidate.displayPath === 'string')
  );
};

export const deriveRamDumpFolderDisplayPath = (treeUri: string, rootName?: string | null) => {
  const trimmed = treeUri?.trim();
  const fallback = rootName?.trim() || null;
  if (!trimmed) return fallback;
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch (error) {
    addErrorLog('Failed to decode RAM dump folder URI', {
      error: (error as Error).message,
    });
  }
  const match = decoded.match(/tree\/([^?]+)/i);
  const treeId = match?.[1] ?? '';
  if (!treeId) return fallback;
  const parts = treeId.split(':');
  const volume = parts.shift() ?? treeId;
  const rawPath = parts.join(':');
  const volumeLabel = volume === 'primary' ? 'Internal storage' : volume;
  const normalizedPath = rawPath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) {
    return fallback ? `${volumeLabel}/${fallback}` : volumeLabel;
  }
  return `${volumeLabel}/${normalizedPath}`;
};

export const loadRamDumpFolderConfig = (): RamDumpFolderConfig | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(RAM_DUMP_FOLDER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidFolderConfig(parsed)) {
      addErrorLog('Invalid RAM dump folder config payload', { payloadType: typeof parsed });
      return null;
    }
    const displayPath = parsed.displayPath ?? deriveRamDumpFolderDisplayPath(parsed.treeUri, parsed.rootName);
    return { ...parsed, displayPath };
  } catch (error) {
    addErrorLog('Failed to parse RAM dump folder config', {
      error: (error as Error).message,
    });
    return null;
  }
};

export const saveRamDumpFolderConfig = (config: RamDumpFolderConfig) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RAM_DUMP_FOLDER_KEY, JSON.stringify(config));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c64u-ram-dump-folder-updated', { detail: config }));
  }
};

export const clearRamDumpFolderConfig = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(RAM_DUMP_FOLDER_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c64u-ram-dump-folder-updated', { detail: null }));
  }
};
