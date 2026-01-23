import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { listLocalFiles, listLocalFolders } from '@/lib/playback/localFileBrowser';
import { addLog } from '@/lib/logging';
import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import { normalizeSourcePath } from './paths';
import type { SourceEntry, SourceLocation } from './types';
import { getLocalSourceRuntimeFile, type LocalSourceRecord } from './localSourcesStore';

const toLocalPlayFile = (entry: { relativePath: string; name: string }): LocalPlayFile => ({
  name: entry.name,
  webkitRelativePath: entry.relativePath,
  lastModified: Date.now(),
  arrayBuffer: async () => new ArrayBuffer(0),
});

const buildFileList = (source: LocalSourceRecord) =>
  source.entries.map((entry) => toLocalPlayFile(entry));

const toSourceEntryPath = (relativePath: string) => normalizeSourcePath(relativePath);

const resolveRootPath = (source: LocalSourceRecord) => {
  if (source.android?.treeUri) return '/';
  const normalizedRoot = normalizeSourcePath(source.rootPath || '/');
  if (!source.entries.length || normalizedRoot === '/') return '/';
  const hasRootedEntry = source.entries.some((entry) =>
    normalizeSourcePath(entry.relativePath).startsWith(normalizedRoot),
  );
  return hasRootedEntry ? normalizedRoot : '/';
};

const normalizeSafPath = (path: string) => normalizeSourcePath(path || '/');

const listSafEntries = async (source: LocalSourceRecord, path: string): Promise<SourceEntry[]> => {
  if (!source.android?.treeUri) {
    throw new Error('Missing SAF handle for Android local source.');
  }
  const normalized = normalizeSafPath(path);
  const response = await FolderPicker.listChildren({ treeUri: source.android.treeUri, path: normalized });
  const entries = response.entries.map((entry) => ({
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
      addLog('debug', 'Android local source missing SAF handle', { sourceId: source.id });
      throw new Error('This folder must be re-added using the Android folder picker.');
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
    return source.entries
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
    isAvailable: !source.requiresReselect && (!isAndroid || Boolean(source.android?.treeUri)),
    listEntries,
    listFilesRecursive,
  };
};

export const resolveLocalRuntimeFile = (sourceId: string, path: string) =>
  getLocalSourceRuntimeFile(sourceId, path);
