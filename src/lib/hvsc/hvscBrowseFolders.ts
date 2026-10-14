/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { type TimeSlicer } from "@/lib/async/timeSlice";
import type { HvscBrowseFolderRow, HvscBrowseIndexedSong } from "@/lib/hvsc/hvscBrowseIndexStore";

export const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);
export const normalizeFolderPath = (path: string) => {
  const normalized = normalizePath(path || "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
};

const createFolderBuilder = () => {
  const folderMap = new Map<string, { folders: Set<string>; songs: Set<string> }>();
  const ensureFolder = (path: string) => {
    const normalized = normalizeFolderPath(path);
    const current = folderMap.get(normalized);
    if (current) return current;
    const next = { folders: new Set<string>(), songs: new Set<string>() };
    folderMap.set(normalized, next);
    return next;
  };

  const root = ensureFolder("/");
  // Most tunes share a composer folder. Resolve each hierarchy once, rather than
  // splitting and rebuilding the same parent chain for every one of 60,000 songs.
  // This map belongs to this build only; no additional library stays resident.
  const parents = new Map<string, ReturnType<typeof ensureFolder>>([["", root]]);
  const add = (song: HvscBrowseIndexedSong) => {
    const normalizedSongPath = normalizePath(song.virtualPath);
    const hierarchyPath = normalizedSongPath.endsWith("/")
      ? normalizedSongPath.replace(/\/+$/, "")
      : normalizedSongPath;
    const parentPath = hierarchyPath.slice(0, hierarchyPath.lastIndexOf("/"));
    let parent = parents.get(parentPath);
    if (!parent) {
      let currentPath = "/";
      for (const folderName of parentPath.split("/").filter(Boolean)) {
        const nextPath = normalizeFolderPath(`${currentPath === "/" ? "" : currentPath}/${folderName}`);
        ensureFolder(currentPath).folders.add(nextPath);
        currentPath = nextPath;
      }
      parent = ensureFolder(currentPath);
      parents.set(parentPath, parent);
    }
    parent.songs.add(normalizedSongPath);
  };

  const finish = () => {
    const folders: Record<string, HvscBrowseFolderRow> = {};
    folderMap.forEach((value, path) => {
      folders[path] = {
        path,
        folders: Array.from(value.folders).sort((a, b) => a.localeCompare(b)),
        songs: Array.from(value.songs).sort((a, b) => a.localeCompare(b)),
      };
    });
    return folders;
  };

  return { add, finish };
};

export const buildFoldersFromSongs = (songs: Record<string, HvscBrowseIndexedSong>) => {
  const builder = createFolderBuilder();
  for (const song of Object.values(songs)) builder.add(song);
  return builder.finish();
};

/** {@link buildFoldersFromSongs} that hands the main thread back between slices of songs. */
export const buildFoldersFromSongsSliced = async (songs: Record<string, HvscBrowseIndexedSong>, slice: TimeSlicer) => {
  const builder = createFolderBuilder();
  for (const song of Object.values(songs)) {
    if (slice.due()) await slice.yield();
    builder.add(song);
  }
  return builder.finish();
};
