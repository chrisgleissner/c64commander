/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import type { ArchivePlaylistReference } from "./types";

export type CachedArchivePlayback = {
  category: PlayFileCategory;
  path: string;
  file: LocalPlayFile;
};

const playbackCache = new Map<string, CachedArchivePlayback>();

export const buildArchivePlaybackCacheKey = (reference: ArchivePlaylistReference) =>
  [reference.sourceId, reference.resultId, String(reference.category), String(reference.entryId)].join(":");

export const getCachedArchivePlayback = (reference: ArchivePlaylistReference) =>
  playbackCache.get(buildArchivePlaybackCacheKey(reference)) ?? null;

export const setCachedArchivePlayback = (reference: ArchivePlaylistReference, playback: CachedArchivePlayback) => {
  playbackCache.set(buildArchivePlaybackCacheKey(reference), playback);
  return playback;
};

export const clearArchivePlaybackCacheForTests = () => {
  playbackCache.clear();
};
