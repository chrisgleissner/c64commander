import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { listLocalFiles, listLocalFolders } from '@/lib/playback/localFileBrowser';
import { normalizeScopedPath } from './paths';
import type { ScopedEntry, ScopedSource } from './types';
import { getLocalSourceRuntimeFile, type LocalSourceRecord } from './localSourcesStore';

const toLocalPlayFile = (entry: { relativePath: string; name: string }): LocalPlayFile => ({
  name: entry.name,
  webkitRelativePath: entry.relativePath,
  lastModified: Date.now(),
  arrayBuffer: async () => new ArrayBuffer(0),
});

const buildFileList = (source: LocalSourceRecord) =>
  source.entries.map((entry) => toLocalPlayFile(entry));

const toScopedEntryPath = (relativePath: string) => normalizeScopedPath(relativePath);

export const createLocalScopedSource = (source: LocalSourceRecord): ScopedSource => {
  const listEntries = async (path: string): Promise<ScopedEntry[]> => {
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

  const listFilesRecursive = async (path: string): Promise<ScopedEntry[]> => {
    const normalized = normalizeScopedPath(path);
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return source.entries
      .map((entry) => ({
        type: 'file' as const,
        name: entry.name,
        path: toScopedEntryPath(entry.relativePath),
      }))
      .filter((entry) => entry.path.startsWith(prefix) || entry.path === normalized);
  };

  return {
    id: source.id,
    type: 'local',
    name: source.name,
    rootPath: source.rootPath,
    isAvailable: !source.requiresReselect,
    listEntries,
    listFilesRecursive,
  };
};

export const resolveLocalRuntimeFile = (sourceId: string, path: string) =>
  getLocalSourceRuntimeFile(sourceId, path);