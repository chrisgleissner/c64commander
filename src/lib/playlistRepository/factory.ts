/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isNativePlatform } from "@/lib/native/platform";
import { addErrorLog } from "@/lib/logging";
import type { PlaylistDataRepository } from "./repository";
import { getIndexedDbPlaylistDataRepository } from "./indexedDbRepository";
import { getLocalStoragePlaylistDataRepository } from "./localStorageRepository";

let repository: PlaylistDataRepository | null = null;

const canUseIndexedDb = () => typeof indexedDB !== "undefined";

export const getPlaylistDataRepository = (): PlaylistDataRepository => {
  if (repository) return repository;

  if (canUseIndexedDb()) {
    repository = getIndexedDbPlaylistDataRepository({
      preferDurableStorage: isNativePlatform(),
    });
    return repository;
  }

  addErrorLog(
    "IndexedDB is unavailable — falling back to localStorage repository. " +
    "Large playlists will not perform well in this environment.",
    {},
  );
  repository = getLocalStoragePlaylistDataRepository();
  return repository;
};

export const resetPlaylistDataRepositoryForTests = () => {
  repository = null;
};
