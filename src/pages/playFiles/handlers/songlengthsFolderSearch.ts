/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { isSonglengthsFileName, mayHoldSonglengthsFile } from "@/lib/sid/songlengthsDiscovery";
import { isDeviceAnswer } from "@/lib/sourceNavigation/connectionFailure";
import type { createConfigListing } from "@/lib/sourceNavigation/guardedConfigListing";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

const folderKey = (folder: string) => normalizeSourcePath(folder).replace(/(.)\/+$/, "$1");

type SearchOptions = {
  candidatePaths: readonly string[];
  listing: ReturnType<typeof createConfigListing>;
  sourceId: string;
  throwIfAborted: () => void;
  isAbortError: (error: unknown) => boolean;
  onSonglengthsEntry: (entry: SourceEntry) => void;
};

/**
 * Looks for a songlengths file in the folders on the way to each tune, shallowest first, asking only folders that
 * can hold one. The first listing the device does not answer ends the search, so a device that is gone costs one
 * timeout, and the folders it did not reach are returned for a retry once the device answers. A folder that was
 * not listed is not taken for an empty one, which would hide every folder below it from the retry.
 */
export const searchSonglengthsFolders = async ({
  candidatePaths,
  listing,
  sourceId,
  throwIfAborted,
  isAbortError,
  onSonglengthsEntry,
}: SearchOptions): Promise<string[]> => {
  const folders = new Set(candidatePaths.map((path) => normalizeSourcePath(path.replace(/\/[^/]+$/, "/") || "/")));
  const ordered = [...folders].sort((a, b) => a.length - b.length);
  const listed = new Map<string, SourceEntry[]>();
  for (const folder of ordered) {
    if (!mayHoldSonglengthsFile(folder, listed)) continue;
    try {
      throwIfAborted();
      const skippedBefore = listing.skippedLookups();
      const entries = await listing.listSonglengthsFolder(folder);
      if (listing.skippedLookups() > skippedBefore) return notReached(ordered, listed);
      listed.set(folderKey(folder), entries);
      throwIfAborted();
      const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
      if (songEntry) onSonglengthsEntry(songEntry);
    } catch (error) {
      if (isAbortError(error)) throw error;
      addLog("debug", "Failed to list entries while scanning for songlengths file", {
        folder,
        sourceId,
        error: (error as Error).message,
      });
      if (!isDeviceAnswer(error)) return notReached(ordered, listed);
    }
  }
  return [];
};

const notReached = (ordered: readonly string[], listed: Map<string, SourceEntry[]>) =>
  ordered.filter((folder) => !listed.has(folderKey(folder)) && mayHoldSonglengthsFile(folder, listed));
