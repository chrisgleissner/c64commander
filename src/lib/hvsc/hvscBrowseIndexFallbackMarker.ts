/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

export const FALLBACK_MARKER_KEY = "c64u_hvsc_browse_index:filesystem-stale";

/** Removes the keys one by one. Never throws: a failed removal is logged and the others are still attempted. */
export const removeLocalStorageKeys = (keys: readonly string[]) => {
  if (typeof localStorage === "undefined") return;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      addLog("warn", "Failed to remove HVSC browse index key from localStorage", {
        key,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }
};

/** Throws when localStorage rejects the marker, so the caller treats the localStorage copy as not stored. */
export const markFilesystemSnapshotStale = () => localStorage.setItem(FALLBACK_MARKER_KEY, "1");

export const clearFilesystemSnapshotStale = () => removeLocalStorageKeys([FALLBACK_MARKER_KEY]);

export const isFilesystemSnapshotStale = () => {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(FALLBACK_MARKER_KEY) !== null;
  } catch (error) {
    addLog("warn", "Failed to read HVSC browse index fallback marker", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return false;
  }
};
