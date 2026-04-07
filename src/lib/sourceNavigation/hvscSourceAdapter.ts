/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getHvscFolderListing, getHvscFolderListingPaged, getHvscSongsRecursive } from "@/lib/hvsc";
import { getHvscDisplayAuthor, getHvscDisplayTitle } from "@/lib/hvsc/hvscBrowseIndexStore";
import { normalizeSourcePath } from "./paths";
import { SOURCE_LABELS } from "./sourceTerms";
import type { SourceEntry, SourceEntryPage, SourceLocation } from "./types";

const normalizeHvscPath = (path: string) => normalizeSourcePath(path || "/");

const sortEntriesByName = (entries: SourceEntry[]) =>
  [...entries].sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));

const folderToEntry = (path: string): SourceEntry => ({
  type: "dir",
  name: path.split("/").pop() || path,
  path: normalizeHvscPath(path),
});

const songToEntry = (song: {
  virtualPath: string;
  fileName: string;
  displayTitleSeed?: string | null;
  displayAuthorSeed?: string | null;
  canonicalTitle?: string | null;
  canonicalAuthor?: string | null;
  released?: string | null;
  durationSeconds?: number | null;
  durationsSeconds?: number[] | null;
  defaultSong?: number | null;
  sidMetadata?: { songs?: number; startSong?: number } | null;
  trackSubsongs?: Array<{ songNr: number; isDefault: boolean }> | null;
  subsongCount?: number | null;
}): SourceEntry => ({
  type: "file",
  name: getHvscDisplayTitle(song),
  path: normalizeHvscPath(song.virtualPath),
  subtitle: getHvscDisplayAuthor(song),
  durationMs: song.durationSeconds != null ? song.durationSeconds * 1000 : undefined,
  songNr:
    song.trackSubsongs?.find((entry) => entry.isDefault)?.songNr ??
    song.defaultSong ??
    song.sidMetadata?.startSong ??
    undefined,
  subsongCount:
    song.trackSubsongs?.length ??
    song.subsongCount ??
    song.durationsSeconds?.length ??
    song.sidMetadata?.songs ??
    undefined,
});

const mapListingEntries = (folders: string[], songs: Parameters<typeof songToEntry>[0][]) =>
  sortEntriesByName([...folders.map(folderToEntry), ...songs.map(songToEntry)]);

export const createHvscSourceLocation = (rootPath: string): SourceLocation => {
  const normalizedRoot = normalizeHvscPath(rootPath);

  const listEntries = async (path: string): Promise<SourceEntry[]> => {
    const listing = await getHvscFolderListing(path);
    return mapListingEntries(listing.folders, listing.songs);
  };

  const listEntriesPage = async (options: {
    path: string;
    query?: string;
    offset?: number;
    limit?: number;
  }): Promise<SourceEntryPage> => {
    const page = await getHvscFolderListingPaged(options);
    const loadedSongs = page.songs.length;
    const nextOffset = page.offset + loadedSongs < page.totalSongs ? page.offset + loadedSongs : null;
    return {
      entries: mapListingEntries(page.folders, page.songs),
      totalCount: page.totalFolders + page.totalSongs,
      nextOffset,
    };
  };

  const listFilesRecursive = async (path: string, options?: { signal?: AbortSignal }): Promise<SourceEntry[]> => {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // Fast path: synchronous bulk query from the in-memory browse index.
    // Avoids the per-page async overhead, smoke-benchmark snapshots, and
    // Capacitor bridge calls that made the old BFS path take minutes.
    const bulkSongs = await getHvscSongsRecursive(path);
    if (bulkSongs) {
      return bulkSongs.map(songToEntry);
    }

    // Fallback: paged BFS when the browse index is not available.
    const queue = [normalizeHvscPath(path)];
    const visited = new Set<string>();
    const files: SourceEntry[] = [];
    while (queue.length) {
      if (options?.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        if (options?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const page = await getHvscFolderListingPaged({
          path: next,
          offset,
          limit: 200,
        });
        if (offset === 0) {
          page.folders.forEach((folder) => queue.push(normalizeHvscPath(folder)));
        }
        page.songs.forEach((song) => files.push(songToEntry(song)));
        offset += page.songs.length;
        hasMore = offset < page.totalSongs;
      }
    }
    return files;
  };

  return {
    id: "hvsc-library",
    type: "hvsc",
    name: SOURCE_LABELS.hvsc,
    rootPath: normalizedRoot,
    isAvailable: true,
    listEntries,
    listEntriesPage,
    listFilesRecursive,
  };
};
