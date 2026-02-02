import { getHvscFolderListing } from '@/lib/hvsc';
import { normalizeSourcePath } from './paths';
import type { SourceEntry, SourceLocation } from './types';

const normalizeHvscPath = (path: string) => normalizeSourcePath(path || '/');

const folderToEntry = (path: string): SourceEntry => ({
  type: 'dir',
  name: path.split('/').pop() || path,
  path: normalizeHvscPath(path),
});

const songToEntry = (song: { virtualPath: string; fileName: string; durationSeconds?: number | null }): SourceEntry => ({
  type: 'file',
  name: song.fileName,
  path: normalizeHvscPath(song.virtualPath),
});

export const createHvscSourceLocation = (rootPath: string): SourceLocation => {
  const normalizedRoot = normalizeHvscPath(rootPath);

  const listEntries = async (path: string): Promise<SourceEntry[]> => {
    const listing = await getHvscFolderListing(path);
    const folders = listing.folders.map(folderToEntry);
    const songs = listing.songs.map(songToEntry);
    return [...folders, ...songs].sort((a, b) => a.name.localeCompare(b.name));
  };

  const listFilesRecursive = async (path: string, options?: { signal?: AbortSignal }): Promise<SourceEntry[]> => {
    const queue = [normalizeHvscPath(path)];
    const visited = new Set<string>();
    const files: SourceEntry[] = [];
    while (queue.length) {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      const listing = await getHvscFolderListing(next);
      listing.folders.forEach((folder) => queue.push(normalizeHvscPath(folder)));
      listing.songs.forEach((song) => files.push(songToEntry(song)));
    }
    return files;
  };

  return {
    id: 'hvsc-library',
    type: 'hvsc',
    name: 'HVSC Library',
    rootPath: normalizedRoot,
    isAvailable: true,
    listEntries,
    listFilesRecursive,
  };
};
