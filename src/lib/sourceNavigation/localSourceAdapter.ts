import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { listLocalFiles, listLocalFolders } from '@/lib/playback/localFileBrowser';
import { addLog } from '@/lib/logging';
import { FolderPicker, type SafFolderEntry } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import { normalizeSourcePath } from './paths';
import type { SourceEntry, SourceLocation } from './types';
import {
  getLocalSourceListingMode,
  getLocalSourceRuntimeFile,
  requireLocalSourceEntries,
  type LocalSourceRecord,
} from './localSourcesStore';
import { LocalSourceListingError } from './localSourceErrors';

const toLocalPlayFile = (entry: { relativePath: string; name: string }): LocalPlayFile => ({
  name: entry.name,
  webkitRelativePath: entry.relativePath,
  lastModified: Date.now(),
  arrayBuffer: async () => new ArrayBuffer(0),
});

const buildFileList = (source: LocalSourceRecord) =>
  requireLocalSourceEntries(source, 'localSourceAdapter.buildFileList')
    .map((entry) => toLocalPlayFile(entry));

const toSourceEntryPath = (relativePath: string) => normalizeSourcePath(relativePath);

const resolveRootPath = (source: LocalSourceRecord) => {
  if (source.android?.treeUri) return '/';
  const normalizedRoot = normalizeSourcePath(source.rootPath || '/');
  const entries = requireLocalSourceEntries(source, 'localSourceAdapter.resolveRootPath');
  if (!entries.length || normalizedRoot === '/') return '/';
  const hasRootedEntry = entries.some((entry) =>
    normalizeSourcePath(entry.relativePath).startsWith(normalizedRoot),
  );
  return hasRootedEntry ? normalizedRoot : '/';
};

const normalizeSafPath = (path: string) => normalizeSourcePath(path || '/');

const coerceSafEntries = (value: unknown): SafFolderEntry[] | null => {
  if (Array.isArray(value)) return value as SafFolderEntry[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as SafFolderEntry[] : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    const maybeEntries = (value as { entries?: unknown }).entries;
    if (Array.isArray(maybeEntries)) return maybeEntries as SafFolderEntry[];
  }
  return null;
};

const normalizeSafEntry = (entry: SafFolderEntry): SafFolderEntry | null => {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type !== 'file' && entry.type !== 'dir') return null;
  if (typeof entry.name !== 'string' || typeof entry.path !== 'string') return null;
  return entry;
};

const listSafEntries = async (source: LocalSourceRecord, path: string): Promise<SourceEntry[]> => {
  if (!source.android?.treeUri) {
    throw new LocalSourceListingError('Missing SAF handle for Android local source.', 'saf-listing-unavailable', {
      sourceId: source.id,
    });
  }
  const normalized = normalizeSafPath(path);
  const response = await FolderPicker.listChildren({ treeUri: source.android.treeUri, path: normalized });
  const rawEntries = coerceSafEntries(response?.entries);
  if (!rawEntries) {
    throw new LocalSourceListingError('SAF listChildren returned invalid entries.', 'saf-listing-invalid', {
      sourceId: source.id,
      treeUri: redactTreeUri(source.android.treeUri),
      path: normalized,
      entryType: typeof response?.entries,
    });
  }
  const normalizedEntries = rawEntries.map(normalizeSafEntry);
  if (normalizedEntries.some((entry) => !entry)) {
    throw new LocalSourceListingError('SAF listChildren returned invalid entries.', 'saf-listing-invalid', {
      sourceId: source.id,
      treeUri: redactTreeUri(source.android.treeUri),
      path: normalized,
      entryType: typeof response?.entries,
      invalidCount: normalizedEntries.filter((entry) => !entry).length,
    });
  }
  const entries = (normalizedEntries as SafFolderEntry[]).map((entry) => ({
    type: entry.type,
    name: entry.name,
    path: normalizeSafPath(entry.path),
    sizeBytes: entry.sizeBytes ?? null,
    modifiedAt: entry.modifiedAt ?? null,
  }));
  const folders = entries.filter((entry) => entry.type === 'dir').length;
  const files = entries.filter((entry) => entry.type === 'file').length;
  addLog('debug', 'SAF enumerate', {
    sourceId: source.id,
    treeUri: redactTreeUri(source.android.treeUri),
    path: normalized,
    folders,
    files,
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name));
};

const listSafFilesRecursive = async (source: LocalSourceRecord, path: string): Promise<SourceEntry[]> => {
  const root = normalizeSafPath(path);
  const queue = [root];
  const files: SourceEntry[] = [];
  while (queue.length) {
    const next = queue.shift();
    if (!next) continue;
    const entries = await listSafEntries(source, next);
    entries.forEach((entry) => {
      if (entry.type === 'dir') {
        queue.push(entry.path);
      } else {
        files.push(entry);
      }
    });
  }
  return files;
};

export const createLocalSourceLocation = (source: LocalSourceRecord): SourceLocation => {
  const rootPath = resolveRootPath(source);
  const isAndroid = getPlatform() === 'android';
  const listEntries = async (path: string): Promise<SourceEntry[]> => {
    if (source.android?.treeUri) {
      return listSafEntries(source, path);
    }
    if (isAndroid) {
      const error = new LocalSourceListingError(
        'This folder must be re-added using the Android folder picker.',
        'saf-listing-unavailable',
        { sourceId: source.id },
      );
      addLog('debug', 'Android local source missing SAF handle', { sourceId: source.id });
      throw error;
    }
    const files = buildFileList(source);
    const folders = listLocalFolders(files, path).map((folder) => ({
      type: 'dir' as const,
      name: folder.replace(path, '').replace(/\/$/, '') || folder,
      path: folder,
    }));
    const fileEntries = listLocalFiles(files, path).map((file) => ({
      type: 'file' as const,
      name: file.name,
      path: file.path,
    }));
    return [...folders, ...fileEntries].sort((a, b) => a.name.localeCompare(b.name));
  };

  const listFilesRecursive = async (path: string): Promise<SourceEntry[]> => {
    if (source.android?.treeUri) {
      return listSafFilesRecursive(source, path);
    }
    const normalized = normalizeSourcePath(path);
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return requireLocalSourceEntries(source, 'localSourceAdapter.listFilesRecursive')
      .map((entry) => ({
        type: 'file' as const,
        name: entry.name,
        path: toSourceEntryPath(entry.relativePath),
      }))
      .filter((entry) => entry.path.startsWith(prefix) || entry.path === normalized);
  };

  return {
    id: source.id,
    type: 'local',
    name: source.name,
    rootPath,
    isAvailable: !source.requiresReselect && (!isAndroid || getLocalSourceListingMode(source) === 'saf'),
    listEntries,
    listFilesRecursive,
  };
};

export const resolveLocalRuntimeFile = (sourceId: string, path: string) =>
  getLocalSourceRuntimeFile(sourceId, path);
