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
  cachedAt?: number;
};

const MAX_PLAYBACK_CACHE_ENTRIES = 100;
const PLAYBACK_CACHE_TTL_MS = 10 * 60 * 1000;

const playbackCache = new Map<string, CachedArchivePlayback>();

export const buildArchivePlaybackCacheKey = (reference: ArchivePlaylistReference) =>
  [reference.sourceId, reference.resultId, String(reference.category), String(reference.entryId)].join(":");

export const getCachedArchivePlayback = (reference: ArchivePlaylistReference) => {
  const key = buildArchivePlaybackCacheKey(reference);
  const cached = playbackCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.cachedAt !== undefined && Date.now() - cached.cachedAt > PLAYBACK_CACHE_TTL_MS) {
    playbackCache.delete(key);
    return null;
  }

  playbackCache.delete(key);
  playbackCache.set(key, cached);
  return cached;
};

export const setCachedArchivePlayback = (reference: ArchivePlaylistReference, playback: CachedArchivePlayback) => {
  const key = buildArchivePlaybackCacheKey(reference);
  const cachedPlayback: CachedArchivePlayback = {
    ...playback,
    cachedAt: playback.cachedAt ?? Date.now(),
  };

  if (playbackCache.has(key)) {
    playbackCache.delete(key);
  }
  playbackCache.set(key, cachedPlayback);

  if (playbackCache.size > MAX_PLAYBACK_CACHE_ENTRIES) {
    const oldestKey = playbackCache.keys().next().value;
    if (oldestKey !== undefined) {
      playbackCache.delete(oldestKey);
    }
  }

  return cachedPlayback;
};

export const clearArchivePlaybackCache = () => {
  playbackCache.clear();
};

export const clearArchivePlaybackCacheForTests = () => {
  clearArchivePlaybackCache();
};
