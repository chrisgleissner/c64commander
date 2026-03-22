/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type {
  SourceKind,
  TrackRecord,
  PlaylistItemRecord,
  PlaylistSessionRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistQueryRow,
  RandomPlaySession,
} from "./types";

export type {
  TrackRepository,
  PlaylistRepository,
  PlaylistQueryRepository,
  RandomPlayRepository,
  PlaylistDataRepository,
} from "./repository";

export { getLocalStoragePlaylistDataRepository } from "./localStorageRepository";
export { getIndexedDbPlaylistDataRepository } from "./indexedDbRepository";
export { getPlaylistDataRepository, resetPlaylistDataRepositoryForTests } from "./factory";
