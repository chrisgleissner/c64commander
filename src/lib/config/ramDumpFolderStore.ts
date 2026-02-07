import { addErrorLog } from '@/lib/logging';

const RAM_DUMP_FOLDER_KEY = 'c64u_ram_dump_folder:v1';

export type RamDumpFolderConfig = {
  treeUri: string;
  rootName: string | null;
  selectedAt: string;
};

const isValidFolderConfig = (value: unknown): value is RamDumpFolderConfig => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.treeUri === 'string'
    && (candidate.rootName === null || typeof candidate.rootName === 'string')
    && typeof candidate.selectedAt === 'string'
  );
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
    return parsed;
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
