/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

type DirectoryEntry = { name: string; type: string };
type ListDirectory = (path: string) => Promise<{ entries: DirectoryEntry[] }>;

/**
 * The device's top-level storage folders that hold something.
 *
 * An Ultimate lists a card slot as a root even with no card in it (a C64 Ultimate lists "SD" empty and
 * refuses writes there), so a root chosen by name alone can be one nothing can be written to. Empty
 * roots are left out unless every root is empty.
 */
export const listPopulatedStorageRoots = async (listDirectory: ListDirectory): Promise<string[]> => {
  const root = await listDirectory("/");
  const names = root.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  const populated: string[] = [];
  for (const name of names) {
    try {
      const listing = await listDirectory(`/${name}`);
      if (listing.entries.length > 0) populated.push(name);
    } catch (error) {
      addLog("warn", "Could not list a storage root; leaving it out of the storage choice", {
        root: name,
        error: (error as Error).message,
      });
    }
  }
  return populated.length > 0 ? populated : names;
};
