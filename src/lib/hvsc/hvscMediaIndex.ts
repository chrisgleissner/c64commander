/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MediaEntry, MediaIndex } from "@/lib/media-index";
import { FilesystemMediaIndexStorage, JsonMediaIndex, LocalStorageMediaIndexStorage } from "@/lib/media-index";
import type { HvscFolderListing, HvscFolderListingPage } from "./hvscTypes";
import { listHvscFolder } from "./hvscFilesystem";
import {
  buildHvscBrowseIndexFromEntries,
  listFolderFromBrowseIndex,
  listSongsRecursiveFromBrowseIndex,
  streamSongsRecursiveFromBrowseIndex,
  loadHvscBrowseIndexSnapshot,
  saveHvscBrowseIndexSnapshot,
  type HvscBrowseIndexSnapshot,
  type HvscBrowseIndexedSong,
} from "./hvscBrowseIndexStore";

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const mapSongToEntry = (song: HvscFolderListing["songs"][number]): MediaEntry => ({
  path: song.virtualPath,
  name: song.fileName,
  type: "sid",
  durationSeconds: song.durationSeconds ?? null,
});

const normalizeFolder = (path: string) => {
  const normalized = normalizePath(path || "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
};

const createFallbackFolderPage = (
  allEntries: MediaEntry[],
  folderPath: string,
  query: string,
  offset: number,
  limit: number,
): HvscFolderListingPage => {
  const normalizedPath = normalizeFolder(folderPath);
  const normalizedQuery = query.trim().toLowerCase();
  const prefix = normalizedPath === "/" ? "/" : `${normalizedPath}/`;
  const allFolders = new Set<string>();
  const directSongs: Array<{
    path: string;
    name: string;
    durationSeconds?: number | null;
  }> = [];

  allEntries.forEach((entry) => {
    const dir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
    allFolders.add(dir);
    if (!entry.path.startsWith(prefix)) return;
    const remainder = entry.path.slice(prefix.length);
    if (!remainder) return;
    if (remainder.includes("/")) return;
    directSongs.push({
      path: entry.path,
      name: entry.name,
      durationSeconds: entry.durationSeconds ?? null,
    });
  });

  const folderList = Array.from(allFolders)
    .filter((folder) => normalizedQuery.length === 0 || folder.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b));
  const songList = directSongs
    .filter(
      (song) =>
        normalizedQuery.length === 0 ||
        song.name.toLowerCase().includes(normalizedQuery) ||
        song.path.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: normalizedPath,
    folders: folderList,
    songs: songList.slice(offset, offset + limit).map((song) => ({
      id: Math.abs(Array.from(song.path).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)),
      virtualPath: song.path,
      fileName: song.name,
      durationSeconds: song.durationSeconds ?? null,
    })),
    totalFolders: folderList.length,
    totalSongs: songList.length,
    offset,
    limit,
    query: normalizedQuery,
  };
};

export class HvscMediaIndexAdapter implements MediaIndex {
  private entriesSnapshot: MediaEntry[] = [];
  private browseSnapshot: HvscBrowseIndexSnapshot | null = null;

  constructor(
    private readonly index: MediaIndex,
    private readonly listFolder: (path: string) => Promise<HvscFolderListing>,
  ) { }

  async load(): Promise<void> {
    await this.index.load();
    this.entriesSnapshot = this.index.getAll();
    const persistedBrowseSnapshot = await this.loadBrowseSnapshot();
    if (persistedBrowseSnapshot) return;
    this.browseSnapshot = buildHvscBrowseIndexFromEntries(this.entriesSnapshot);
    await saveHvscBrowseIndexSnapshot(this.browseSnapshot);
  }

  async loadBrowseSnapshot(): Promise<HvscBrowseIndexSnapshot | null> {
    if (this.browseSnapshot) return this.browseSnapshot;
    const persistedBrowseSnapshot = await loadHvscBrowseIndexSnapshot();
    if (!persistedBrowseSnapshot) return null;
    this.browseSnapshot = persistedBrowseSnapshot;
    return this.browseSnapshot;
  }

  setBrowseSnapshot(snapshot: HvscBrowseIndexSnapshot | null): void {
    this.browseSnapshot = snapshot;
  }

  clearBrowseSnapshot(): void {
    this.browseSnapshot = null;
  }

  async save(): Promise<void> {
    await this.index.save();
    if (this.browseSnapshot) {
      await saveHvscBrowseIndexSnapshot(this.browseSnapshot);
    }
  }

  async scan(paths: string[]): Promise<void> {
    const queue = paths.length ? [...paths] : ["/"];
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
    this.entriesSnapshot = entries;
    this.browseSnapshot = buildHvscBrowseIndexFromEntries(entries);
    await this.index.save();
    await saveHvscBrowseIndexSnapshot(this.browseSnapshot);
  }

  queryByType(type: MediaEntry["type"]): MediaEntry[] {
    return this.index.queryByType(type);
  }

  queryByPath(path: string): MediaEntry | null {
    return this.index.queryByPath(path);
  }

  getAll(): MediaEntry[] {
    return this.entriesSnapshot.length ? [...this.entriesSnapshot] : this.index.getAll();
  }

  setEntries(entries: MediaEntry[]): void {
    this.index.setEntries(entries);
    this.entriesSnapshot = entries;
    this.browseSnapshot = buildHvscBrowseIndexFromEntries(entries);
  }

  queryFolderPage(options: { path: string; query?: string; offset?: number; limit?: number }): HvscFolderListingPage {
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.max(1, Math.floor(options.limit ?? 200));
    const query = options.query ?? "";
    if (this.browseSnapshot) {
      return listFolderFromBrowseIndex(this.browseSnapshot, options.path, query, offset, limit);
    }
    const entries = this.entriesSnapshot.length ? this.entriesSnapshot : this.index.getAll();
    const page = createFallbackFolderPage(entries, options.path, query, offset, limit);
    this.browseSnapshot = buildHvscBrowseIndexFromEntries(entries);
    return page;
  }

  /**
   * Synchronous bulk recursive listing of all songs under a folder.
   * Returns null when the browse snapshot is not loaded yet
   * (caller should fall back to the paged BFS path).
   */
  querySongsRecursive(path: string): HvscBrowseIndexedSong[] | null {
    if (!this.browseSnapshot) return null;
    return listSongsRecursiveFromBrowseIndex(this.browseSnapshot, path);
  }

  async streamSongsRecursive(
    path: string,
    options: {
      chunkSize?: number;
      onChunk: (songs: HvscBrowseIndexedSong[]) => Promise<void> | void;
    },
  ): Promise<{ totalSongs: number } | null> {
    if (!this.browseSnapshot) return null;
    return streamSongsRecursiveFromBrowseIndex(this.browseSnapshot, path, options);
  }
}

export const createHvscMediaIndex = (listFolder: (path: string) => Promise<HvscFolderListing> = listHvscFolder) =>
  new HvscMediaIndexAdapter(
    new JsonMediaIndex(
      typeof window === "undefined" ? new LocalStorageMediaIndexStorage() : new FilesystemMediaIndexStorage(),
    ),
    (path: string) => listFolder(path),
  );
