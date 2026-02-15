/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { addLog } from '@/lib/logging';
import { redactTreeUri } from '@/lib/native/safUtils';
import { normalizeSourcePath } from './paths';
import { LocalSourceListingError } from './localSourceErrors';
import { SOURCE_LABELS } from './sourceTerms';

export type LocalSourceEntry = {
  name: string;
  relativePath: string;
  uri?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type LocalSourceRecord = {
  id: string;
  name: string;
  rootName: string | null;
  rootPath: string;
  createdAt: string;
  entries?: LocalSourceEntry[];
  android?: {
    treeUri: string;
    rootName: string | null;
    permissionGrantedAt: string;
  };
  requiresReselect?: boolean;
};

export type LocalSourceListingMode = 'entries' | 'saf';

export type LocalSourceBuildResult = {
  source: LocalSourceRecord;
  runtimeFiles: Record<string, File>;
};

const STORE_KEY = 'c64u_local_sources:v1';

const runtimeFilesBySource = new Map<string, Record<string, File>>();

const safeRandomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeRootName = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildRootPath = (rootName: string | null) => {
  if (!rootName) return '/';
  const normalized = normalizeSourcePath(rootName);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

const normalizeLocalSource = (source: LocalSourceRecord): LocalSourceRecord => {
  const hasSaf = Boolean(source.android?.treeUri);
  if (hasSaf) {
    return {
      ...source,
      entries: undefined,
      rootPath: source.rootPath || '/',
    };
  }
  const entries = Array.isArray(source.entries) ? source.entries : [];
  return {
    ...source,
    entries,
    rootPath: source.rootPath || '/',
  };
};

export const loadLocalSources = (): LocalSourceRecord[] => {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalSourceRecord[];
    return Array.isArray(parsed) ? parsed.map((source) => normalizeLocalSource(source)) : [];
  } catch (error) {
    console.warn('Failed to load local sources from storage', { error });
    return [];
  }
};

export const saveLocalSources = (sources: LocalSourceRecord[]) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(sources));
};

export const setLocalSourceRuntimeFiles = (sourceId: string, files: Record<string, File>) => {
  runtimeFilesBySource.set(sourceId, files);
};

export const getLocalSourceRuntimeFile = (sourceId: string, path: string) => {
  const normalized = normalizeSourcePath(path);
  return runtimeFilesBySource.get(sourceId)?.[normalized];
};

export const createLocalSourceFromFileList = (files: FileList | File[], label?: string): LocalSourceBuildResult => {
  const list = Array.from(files);
  const first = list[0] as File & { webkitRelativePath?: string };
  const rootName = first?.webkitRelativePath?.split('/')?.[0] || label || 'Folder';
  const rootPath = buildRootPath(rootName);
  const sourceId = safeRandomId();
  const createdAt = new Date().toISOString();
  const runtimeFiles: Record<string, File> = {};
  const entries: LocalSourceEntry[] = list.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const withLabel = label && !relative.includes('/') ? `${label}/${relative}` : relative;
    const relativePath = withLabel.replace(/^\/+/, '');
    const normalizedPath = normalizeSourcePath(relativePath);
    runtimeFiles[normalizedPath] = file;
    return {
      name: file.name,
      relativePath,
      sizeBytes: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
    };
  });
  const source: LocalSourceRecord = {
    id: sourceId,
    name: rootName,
    rootName,
    rootPath,
    createdAt,
    entries,
  };
  return { source, runtimeFiles };
};

export const prepareDirectoryInput = (input: HTMLInputElement | null) => {
  if (!input) return;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
};

export const createLocalSourceFromPicker = async (input: HTMLInputElement | null): Promise<LocalSourceBuildResult | null> => {
  const platform = getPlatform();
  if ((platform === 'android' || platform === 'ios') && isNativePlatform()) {
    addLog('debug', 'Native folder picker invoked', { platform });
    let result: Awaited<ReturnType<typeof FolderPicker.pickDirectory>>;
    try {
      result = await FolderPicker.pickDirectory();
    } catch (error) {
      addLog('debug', 'Native folder picker failed', { platform, error: (error as Error).message });
      throw error;
    }
    const treeUri = result?.treeUri;
    if (!treeUri || result?.files != null) {
      addLog('debug', 'Native folder picker rejected non-SAF response', {
        platform,
        treeUri: redactTreeUri(treeUri),
        hasEntries: Array.isArray(result?.files),
      });
      throw new Error('Native folder picker returned an unsupported response.');
    }
    const rootName = normalizeRootName(result?.rootName);
    const sourceId = safeRandomId();
    const createdAt = new Date().toISOString();
    addLog('debug', 'Native tree URI received', {
      platform,
      treeUri: redactTreeUri(treeUri),
      rootName,
      permissionPersisted: result?.permissionPersisted === true,
    });
    if (!result?.permissionPersisted) {
      addLog('debug', 'Native persistable permission missing', { platform, treeUri: redactTreeUri(treeUri) });
      throw new Error('Folder access permission could not be persisted.');
    }
    addLog('debug', 'Native persistable permission granted', { platform, treeUri: redactTreeUri(treeUri) });
    const source: LocalSourceRecord = {
      id: sourceId,
      name: rootName || SOURCE_LABELS.local,
      rootName,
      rootPath: '/',
      createdAt,
      entries: undefined,
      android: {
        treeUri,
        rootName,
        permissionGrantedAt: createdAt,
      },
    };
    return { source, runtimeFiles: {} };
  }

  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) {
    input?.click();
    return null;
  }

  const directoryHandle = await picker();
  const files: File[] = [];
  const walkDirectory = async (dirHandle: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (dirHandle as any).entries()) {
      if ((handle as FileSystemHandle).kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${prefix}${name}`,
        });
        files.push(file);
      } else if ((handle as FileSystemHandle).kind === 'directory') {
        await walkDirectory(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
      }
    }
  };

  await walkDirectory(directoryHandle, '');
  return createLocalSourceFromFileList(files, directoryHandle.name);
};

export const getLocalSourceListingMode = (source: LocalSourceRecord): LocalSourceListingMode =>
  source.android?.treeUri ? 'saf' : 'entries';

export const requireLocalSourceEntries = (source: LocalSourceRecord, context: string): LocalSourceEntry[] => {
  if (getLocalSourceListingMode(source) === 'saf') {
    throw new LocalSourceListingError('SAF sources do not expose entry listings.', 'saf-listing-unavailable', {
      sourceId: source.id,
      context,
    });
  }
  if (!Array.isArray(source.entries)) {
    throw new LocalSourceListingError('Local source entries are missing or invalid.', 'local-entries-missing', {
      sourceId: source.id,
      context,
    });
  }
  return source.entries;
};

export const validateSource = async (sourceId: string): Promise<boolean> => {
  const source = loadLocalSources().find((entry) => entry.id === sourceId);
  if (!source) {
    addLog('warn', 'Local source validation failed: source missing', { sourceId });
    return false;
  }

  if (source.android?.treeUri) {
    try {
      await FolderPicker.listChildren({ treeUri: source.android.treeUri, path: '' });
      return true;
    } catch (error) {
      addLog('warn', 'SAF source validation failed', {
        sourceId,
        treeUri: redactTreeUri(source.android.treeUri),
        error: (error as Error).message,
      });
      return false;
    }
  }

  if (!Array.isArray(source.entries)) {
    addLog('warn', 'Local source validation failed: entries missing', { sourceId });
    return false;
  }

  return true;
};
