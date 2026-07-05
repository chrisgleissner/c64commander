/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchivePlaylistReference } from "./types";
import { buildArchivePlaybackCacheKey } from "./archivePlaybackCache";

// A sibling of archivePlaybackCache tuned for disk mounting. Playback caches a
// prepared LocalPlayFile; disk mounting needs the raw image Blob, so the two
// keep separate maps of the same shape (100-entry LRU, 10-min TTL) but share
// the deterministic cache key derived from the archive coordinates. See
// HARD10-002.
export type CachedArchiveDiskBlob = {
  blob: Blob;
  cachedAt?: number;
};

const MAX_DISK_CACHE_ENTRIES = 100;
const DISK_CACHE_TTL_MS = 10 * 60 * 1000;

const diskCache = new Map<string, CachedArchiveDiskBlob>();

export const getCachedArchiveDiskBlob = (reference: ArchivePlaylistReference): Blob | null => {
  const key = buildArchivePlaybackCacheKey(reference);
  const cached = diskCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.cachedAt !== undefined && Date.now() - cached.cachedAt > DISK_CACHE_TTL_MS) {
    diskCache.delete(key);
    return null;
  }

  diskCache.delete(key);
  diskCache.set(key, cached);
  return cached.blob;
};

export const setCachedArchiveDiskBlob = (reference: ArchivePlaylistReference, blob: Blob): Blob => {
  const key = buildArchivePlaybackCacheKey(reference);
  const entry: CachedArchiveDiskBlob = { blob, cachedAt: Date.now() };

  if (diskCache.has(key)) {
    diskCache.delete(key);
  }
  diskCache.set(key, entry);

  if (diskCache.size > MAX_DISK_CACHE_ENTRIES) {
    const oldestKey = diskCache.keys().next().value;
    if (oldestKey !== undefined) {
      diskCache.delete(oldestKey);
    }
  }

  return blob;
};

export const clearArchiveDiskCache = () => {
  diskCache.clear();
};

export const clearArchiveDiskCacheForTests = () => {
  clearArchiveDiskCache();
};
