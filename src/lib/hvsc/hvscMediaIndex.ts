/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MediaEntry, MediaIndex } from '@/lib/media-index';
import { JsonMediaIndex, LocalStorageMediaIndexStorage } from '@/lib/media-index';
import type { HvscFolderListing } from './hvscTypes';
import { listHvscFolder } from './hvscFilesystem';

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const mapSongToEntry = (song: HvscFolderListing['songs'][number]): MediaEntry => ({
  path: song.virtualPath,
  name: song.fileName,
  type: 'sid',
  durationSeconds: song.durationSeconds ?? null,
});

export class HvscMediaIndexAdapter implements MediaIndex {
  constructor(
    private readonly index: MediaIndex,
    private readonly listFolder: (path: string) => Promise<HvscFolderListing>,
  ) {}

  async load(): Promise<void> {
    await this.index.load();
  }

  async save(): Promise<void> {
    await this.index.save();
  }

  async scan(paths: string[]): Promise<void> {
    const queue = paths.length ? [...paths] : ['/'];
    const visited = new Set<string>();
    const entries: MediaEntry[] = [];

    while (queue.length) {
      const current = normalizePath(queue.shift() as string);
      if (visited.has(current)) continue;
      visited.add(current);

      const listing = await this.listFolder(current);
      listing.folders.forEach((folder) => queue.push(folder));
      listing.songs.forEach((song) => entries.push(mapSongToEntry(song)));
    }

    this.index.setEntries(entries);
    await this.index.save();
  }

  queryByType(type: MediaEntry['type']): MediaEntry[] {
    return this.index.queryByType(type);
  }

  queryByPath(path: string): MediaEntry | null {
    return this.index.queryByPath(path);
  }

  getAll(): MediaEntry[] {
    return this.index.getAll();
  }

  setEntries(entries: MediaEntry[]): void {
    this.index.setEntries(entries);
  }
}

export const createHvscMediaIndex = (listFolder: (path: string) => Promise<HvscFolderListing> = listHvscFolder) =>
  new HvscMediaIndexAdapter(
    new JsonMediaIndex(new LocalStorageMediaIndexStorage()),
    (path: string) => listFolder(path),
  );
