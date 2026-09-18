/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The directory listings an add hands to config discovery, and the one rule about which ones count.
 *
 * `discoverConfigCandidates` reads its prefetched map as "this is everything in that folder". A
 * folder that was never listed cannot answer that. The files an add knows about without listing are
 * the ones the user ticked, and a settings file beside a program is exactly the file nobody ticks —
 * so handing those over as a directory's contents reports that the program has no settings file.
 * That is what happened on hardware: a `.cfg` next to a PRG on a C64 Ultimate stayed unresolved
 * when the program was added, and resolved as "same name, high confidence" the moment the config
 * sheet's Re-discover listed the folder for real.
 *
 * Keys are spelled one way. `getParentPath` ends a directory with a slash and an entry's own `path`
 * does not, so a listing stored under "/Usb0/Games" was never found by a lookup for "/Usb0/Games/".
 */

import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

/** One spelling for a directory, whichever end of the add wrote it. */
export const directoryListingKey = (path: string) => {
  const normalized = normalizeSourcePath(path);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export type ConfigEntryPrefetchOptions = {
  /** Full listings, by {@link directoryListingKey}. A directory absent here was never listed. */
  listingCache: Map<string, SourceEntry[]>;
  /** The files the user picked, by the parent path the add groups them under. */
  selectedFilesByParent: Map<string, SourceEntry[]>;
  /** The add's merge of a listed directory's files with the ones picked inside it. */
  directoryEntriesFor: (parentPath: string) => SourceEntry[];
};

/**
 * A memoized "everything in these folders" map, built once per folder on first need.
 *
 * Rebuilding it inside the per-file loop made the merge work quadratic in the per-folder file count
 * for a single-folder batch add (HARD12-015); only the rebuild cadence changed, not the content.
 */
export const createConfigEntryPrefetch = ({
  listingCache,
  selectedFilesByParent,
  directoryEntriesFor,
}: ConfigEntryPrefetchOptions) => {
  const prefetched = new Map<string, SourceEntry[]>();
  return () => {
    selectedFilesByParent.forEach((_, path) => {
      const key = directoryListingKey(path);
      if (!listingCache.has(key) || prefetched.has(key)) return;
      prefetched.set(key, directoryEntriesFor(path));
    });
    listingCache.forEach((entries, path) => {
      const key = directoryListingKey(path);
      if (prefetched.has(key)) return;
      const merged = new Map<string, SourceEntry>();
      entries.forEach((entry) => {
        if (entry.type === "file") merged.set(normalizeSourcePath(entry.path), entry);
      });
      prefetched.set(key, [...merged.values()]);
    });
    return prefetched;
  };
};
